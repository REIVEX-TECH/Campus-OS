import { z } from 'zod';
import { getTenantRegistry } from '@/lib/tenants';
import { grantRole, revokeRole } from '@campusos/module-identity/rbac';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';

/**
 * Give a member a role, or take one away.
 *
 * Same origin and the per client limit are checked before anything else, on
 * every caller. After that, signed out or without `manage-roles` in the named
 * tenant, this route is 404: an admin route is not an oracle for who is an
 * admin. The grant itself re-checks the permission inside its transaction, so
 * this gate is the first of two, never the only one.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
  roleKey: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  action: z.enum(['grant', 'revoke']),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-roles:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  const write = tenant ? await tenantWriteContext(tenant.slug, 'manage-roles') : null;
  if (!tenant || !write) return Response.json({ error: 'not_found' }, { status: 404 });

  const actor = { userId: write.actor.userId };
  const { userId, roleKey, action } = parsed.data;
  const result =
    action === 'grant'
      ? await grantRole(actor, tenant.slug, userId, roleKey, write.access)
      : await revokeRole(actor, tenant.slug, userId, roleKey, write.access);
  if (!result.ok) {
    if (result.reason === 'last_admin') {
      return Response.json({ error: 'last_admin' }, { status: 409 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ changed: result.changed });
}
