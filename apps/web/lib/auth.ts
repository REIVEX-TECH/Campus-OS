import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { membershipFor, type Membership } from '@campusos/module-identity/membership';
import { resolveSession, type Actor } from '@campusos/module-identity/sessions';
import { clientKey } from './rate-limit';

/**
 * Who is signed in, for server components and route handlers.
 *
 * Nothing is gated on this yet: sign in exists so an account can be created and
 * recognised, and the guard that turns an actor into an authorisation decision
 * arrives with per-module access rules. Reading it is always safe on a public
 * page, which is the point: the timetable must keep working signed out.
 */

export const SESSION_COOKIE = 'campusos_session';

/** Cookie options. Kept in one place so the route handlers cannot disagree. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Lax rather than Strict: a link from an email or another site should still
    // land the reader on a page that knows them. Sign in itself is a POST from
    // our own origin, so Lax is enough to blunt cross-site submission.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  };
}

/**
 * The current actor, or null when nobody is signed in.
 *
 * Every call resolves the session against the database rather than trusting
 * anything in the cookie beyond the opaque token, so revoking a session takes
 * effect on the very next request.
 */
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token);
}

/**
 * A coarse, non-identifying fingerprint of the caller, stored with a session so
 * a user can recognise their own devices later. Hashed because CLAUDE.md 8 keeps
 * PII out of storage: this can confirm "same client" without recording who or
 * where they are.
 */
export async function requestFingerprint(): Promise<{ userAgent?: string; ipHash?: string }> {
  const h = await headers();
  const userAgent = h.get('user-agent') ?? undefined;
  // The proxy vouched address, the same one the rate limiter keys on.
  const address = clientKey(h);
  return {
    userAgent,
    ipHash: address !== 'unknown' ? createHash('sha256').update(address).digest('hex') : undefined,
  };
}

export interface TenantAdmin {
  actor: Actor;
  membership: Membership;
}

/**
 * The signed in tenant administrator for this slug, or null.
 *
 * The role is a membership row read on this request, as the person themselves;
 * never a cookie claim, never client input. Every mutation behind this gate
 * re-checks the role inside its own transaction, so this is the first of two
 * checks and never the only one.
 */
export async function tenantAdmin(slug: string): Promise<TenantAdmin | null> {
  const actor = await currentActor();
  if (!actor) return null;
  const membership = await membershipFor(actor.userId, slug);
  if (!membership || membership.role !== 'tenant_admin' || membership.status !== 'active') {
    return null;
  }
  return { actor, membership };
}

/** As above, but a page: anyone else gets a 404, not a hint. */
export async function requireTenantAdmin(slug: string): Promise<TenantAdmin> {
  const admin = await tenantAdmin(slug);
  if (!admin) notFound();
  return admin;
}
