import { z } from 'zod';
import { HANDLE_PATTERN } from '@campusos/module-identity/handle-rules';
import { userIdByHandle, verifyMember } from '@campusos/module-identity/verification';
import { tenantAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Mark a member verified by hand, found by their public handle.
 *
 * Same gate as a decision: 404 unless the caller is a tenant_admin here, the
 * role re-checked inside the transaction, and never oneself.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  handle: z.string().trim().regex(HANDLE_PATTERN),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const admin = await tenantAdmin(parsed.data.tenant);
  if (!admin) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-verify:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const userId = await userIdByHandle(parsed.data.handle);
  if (!userId) return Response.json({ error: 'no_such_handle' }, { status: 404 });

  const result = await verifyMember({ userId: admin.actor.userId }, parsed.data.tenant, userId);
  if (!result.ok) {
    if (result.error === 'self') return Response.json({ error: 'self' }, { status: 409 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json(result.value);
}
