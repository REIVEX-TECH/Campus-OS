import { z } from 'zod';
import { findMemberByEmail } from '@campusos/module-identity/rbac';
import { getTenantRegistry } from '@/lib/tenants';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';

/**
 * Find a member of this tenant by email, for granting them a role.
 *
 * Same origin and the per-client limit first, then `manage-roles` in the named
 * tenant through the seam (404 otherwise: an admin route is not an oracle). The
 * definer re-checks the permission and resolves the email ONLY to a member of
 * this tenant, so this never reveals whether an address has an account elsewhere.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  email: z.string().email().max(320),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-find:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  const write = tenant ? await tenantWriteContext(tenant.slug, 'manage-roles') : null;
  if (!tenant || !write) return Response.json({ error: 'not_found' }, { status: 404 });

  const found = await findMemberByEmail(
    { userId: write.actor.userId },
    tenant.slug,
    parsed.data.email,
    write.access,
  );
  return Response.json({ found });
}
