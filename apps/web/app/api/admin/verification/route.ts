import { z } from 'zod';
import { tenantRegistry } from '@campusos/tenants';
import { decideRequest } from '@campusos/module-identity/verification';
import { tenantAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Approve or reject a verification request.
 *
 * Same origin and the per client limit are checked before anything else, on
 * every caller. After that, signed out or without the tenant_admin role in the
 * named tenant, this route is 404: an admin route is not an oracle for who is
 * an admin. The decision itself re-checks the role inside its transaction, so
 * this gate is the first of two, never the only one.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  requestId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-decide:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = tenantRegistry.resolveBySlug(parsed.data.tenant);
  const admin = tenant ? await tenantAdmin(tenant.slug) : null;
  if (!tenant || !admin) return Response.json({ error: 'not_found' }, { status: 404 });

  const result = await decideRequest(
    { userId: admin.actor.userId },
    tenant.slug,
    parsed.data.requestId,
    parsed.data.decision,
  );
  if (!result.ok) {
    if (result.error === 'self') return Response.json({ error: 'self' }, { status: 409 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json(result.value);
}
