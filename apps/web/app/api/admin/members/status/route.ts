import { z } from 'zod';
import { getTenantRegistry } from '@/lib/tenants';
import { setMemberStatus } from '@campusos/module-identity/members';
import { permitted } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Suspend a membership, or reinstate it.
 *
 * Same gate as every admin mutation: origin and the per client limit on every
 * caller, then 404 without `manage-members`, re-checked inside the transaction
 * that does the work. Never oneself, and never the last administrator.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
  status: z.enum(['active', 'suspended']),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-member-status:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  const manager = tenant ? await permitted(tenant.slug, 'manage-members') : null;
  if (!tenant || !manager) return Response.json({ error: 'not_found' }, { status: 404 });

  const result = await setMemberStatus(
    { userId: manager.actor.userId },
    tenant.slug,
    parsed.data.userId,
    parsed.data.status,
  );
  if (!result.ok) {
    if (result.error === 'self' || result.error === 'last_admin') {
      return Response.json({ error: result.error }, { status: 409 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json(result.value);
}
