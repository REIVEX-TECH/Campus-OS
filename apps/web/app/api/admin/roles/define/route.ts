import { z } from 'zod';
import { isPermission } from '@campusos/core';
import { tenantRegistry } from '@campusos/tenants';
import { createRole, setRolePermissions } from '@campusos/module-identity/rbac';
import { permitted } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Create a role of the tenant's own, or replace what one may do.
 *
 * A body naming a `roleKey` updates that role; one carrying a `name` creates a
 * new one. Same gate as every admin mutation: origin and the per client limit
 * on every caller, then 404 without `manage-roles`, re-checked inside the
 * transaction that does the work.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    tenant: z.string().min(1).max(64),
    roleKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,40}$/)
      .optional(),
    name: z.string().trim().min(1).max(60).optional(),
    permissions: z.array(z.string().refine(isPermission)).max(32),
  })
  .refine((b) => (b.roleKey === undefined) !== (b.name === undefined));

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-roles-define:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = tenantRegistry.resolveBySlug(parsed.data.tenant);
  const manager = tenant ? await permitted(tenant.slug, 'manage-roles') : null;
  if (!tenant || !manager) return Response.json({ error: 'not_found' }, { status: 404 });

  const actor = { userId: manager.actor.userId };
  const { roleKey, name, permissions } = parsed.data;

  if (roleKey !== undefined) {
    const result = await setRolePermissions(actor, tenant.slug, roleKey, permissions);
    if (!result.ok) {
      if (result.reason === 'system_role') {
        return Response.json({ error: 'system_role' }, { status: 409 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({ changed: result.changed });
  }

  const result = await createRole(actor, tenant.slug, { name: name ?? '', permissions });
  if (!result.ok) {
    if (result.reason === 'exists') return Response.json({ error: 'exists' }, { status: 409 });
    if (result.reason === 'bad_name') return Response.json({ error: 'bad_name' }, { status: 400 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ role: { key: result.role.key, name: result.role.name } });
}
