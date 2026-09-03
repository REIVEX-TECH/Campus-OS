import { cookies } from 'next/headers';
import { z } from 'zod';
import { IdentityProviderNotConfiguredError, InvalidIdentityTokenError } from '@campusos/core/auth';
import { googleVerifierFromEnv } from '@campusos/module-identity/auth';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser, issueSession, revokeSession } from '@campusos/module-identity/sessions';
import { tenantRegistry } from '@campusos/tenants';
import { SESSION_COOKIE, requestFingerprint, sessionCookieOptions } from '@/lib/auth';

/**
 * Exchange a provider token for a CampusOS session, and sign out.
 *
 * The provider proves the person controls a Google account. Everything after
 * that is ours: the user row, the session, and the cookie. The provider token is
 * used once, here, and never stored.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  idToken: z.string().min(1).max(4096),
  /**
   * Which university the person is signing in to. Middleware does not run on
   * /api, so this comes from the client; that is safe, because naming a tenant
   * grants nothing. Whether the address earns a membership is decided here,
   * against that tenant's own config, from the email the provider verified.
   */
  tenant: z.string().min(1).max(64).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const verifier = googleVerifierFromEnv();
  if (!verifier) {
    // Not the caller's fault, and worth saying plainly rather than as a 401.
    return Response.json({ error: 'sign_in_not_configured' }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });

  try {
    const identity = await verifier.verify(parsed.data.idToken);
    const actor = await findOrCreateUser(identity);
    // Membership is a consequence of signing in, not part of it: a person whose
    // address is not on the tenant's list still gets an account and a session,
    // and simply is not a member. Nothing here reports which happened.
    const tenant = parsed.data.tenant ? tenantRegistry.resolveBySlug(parsed.data.tenant) : null;
    if (tenant) await ensureDomainMembership(actor, tenant);
    const session = await issueSession(actor, await requestFingerprint());

    (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    // The handle is the public identity; the email never leaves the server.
    return Response.json({ handle: actor.handle });
  } catch (error) {
    if (error instanceof InvalidIdentityTokenError) {
      return Response.json({ error: 'invalid_token' }, { status: 401 });
    }
    if (error instanceof IdentityProviderNotConfiguredError) {
      return Response.json({ error: 'sign_in_not_configured' }, { status: 503 });
    }
    throw error;
  }
}

/** Sign out. The session is revoked server side, not just forgotten by the browser. */
export async function DELETE(): Promise<Response> {
  const jar = await cookies();
  await revokeSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
