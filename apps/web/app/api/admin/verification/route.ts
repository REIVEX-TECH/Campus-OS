import { z } from 'zod';
import { decideRequest } from '@campusos/module-identity/verification';
import { tenantAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Approve or reject a verification request.
 *
 * Signed out, or signed in without the tenant_admin role in the named tenant,
 * this route is 404: an admin route is not an oracle for who is an admin. The
 * decision itself re-checks the role inside its transaction, so this gate is
 * the first of two, never the only one.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  requestId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const admin = await tenantAdmin(parsed.data.tenant);
  if (!admin) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-decide:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const result = await decideRequest(
    { userId: admin.actor.userId },
    parsed.data.tenant,
    parsed.data.requestId,
    parsed.data.decision,
  );
  if (!result.ok) {
    if (result.error === 'self') return Response.json({ error: 'self' }, { status: 409 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json(result.value);
}
