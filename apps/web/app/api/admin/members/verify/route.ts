import { z } from 'zod';
import { getTenantRegistry } from '@/lib/tenants';
import { CUSTOM_HANDLE_PATTERN } from '@campusos/module-identity/handle-rules';
import { userIdByHandle, verifyMember } from '@campusos/module-identity/verification';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';

/**
 * Mark a member verified by hand, found by their public handle.
 *
 * Same gate as a decision: cheap checks first on every caller, then 404 unless
 * the caller holds `approve-verifications` here, re-checked inside the
 * transaction, and never oneself. A handle may be generated or chosen, so the
 * chosen shape (a superset) is what is accepted.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  handle: z.string().trim().regex(CUSTOM_HANDLE_PATTERN),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-verify:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  const write = tenant ? await tenantWriteContext(tenant.slug, 'approve-verifications') : null;
  if (!tenant || !write) return Response.json({ error: 'not_found' }, { status: 404 });

  const userId = await userIdByHandle(parsed.data.handle);
  if (!userId) return Response.json({ error: 'no_such_handle' }, { status: 404 });

  const result = await verifyMember(
    { userId: write.actor.userId },
    tenant.slug,
    userId,
    write.access,
  );
  if (!result.ok) {
    if (result.error === 'self') return Response.json({ error: 'self' }, { status: 409 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json(result.value);
}
