import { z } from 'zod';
import { revokeTenantGrant } from '@campusos/module-identity/grants';
import { platformAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Close (revoke) a platform grant. auth_revoke_tenant_grant authorises by the
 * grant's own admin (the caller), so a platform admin can close the grant they
 * hold from any of their sessions; it is a no-op for an already-closed grant.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ grantId: z.string().uuid() });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`grant-close:${clientKey(request.headers)}`, 20, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await platformAdmin();
  if (!admin) return Response.json({ error: 'forbidden' }, { status: 404 });

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });

  await revokeTenantGrant(admin.actor.userId, parsed.data.grantId, 'closed by the admin');
  return Response.json({ ok: true });
}
