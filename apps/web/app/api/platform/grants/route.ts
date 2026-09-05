import { z } from 'zod';
import { withPlatformGrant } from '@campusos/db';
import { currentPlatformActor, platformAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

/**
 * Open a cross-tenant platform grant. Platform admins only; the grant is opened
 * for 30 minutes (auth_open_tenant_grant), audited, and one-open-at-a-time. On
 * success the client navigates to /u/{tenant}/admin, where the seam re-enters it.
 */
export const dynamic = 'force-dynamic';

const GRANT_MINUTES = 30;
const MIN_REASON = 12;

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  reason: z.string().min(1).max(500),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`grant-open:${clientKey(request.headers)}`, 20, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  // A non-admin gets the same 404 the admin surfaces give: no hint it exists.
  const admin = await platformAdmin();
  const pa = await currentPlatformActor();
  if (!admin || !pa) return Response.json({ error: 'forbidden' }, { status: 404 });

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const { tenant, reason } = parsed.data;
  if (reason.trim().length < MIN_REASON) {
    return Response.json({ error: 'reason_too_short' }, { status: 400 });
  }
  if (!(await getTenantRegistry()).resolveBySlug(tenant)) {
    return Response.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  try {
    await withPlatformGrant(pa, tenant, reason, async () => undefined, GRANT_MINUTES);
    return Response.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === '55006') return Response.json({ error: 'already_open' }, { status: 409 });
    if (code === '22023') return Response.json({ error: 'reason_too_short' }, { status: 400 });
    if (code === '42704') return Response.json({ error: 'unknown_tenant' }, { status: 404 });
    if (code === '42501') return Response.json({ error: 'forbidden' }, { status: 404 });
    throw error;
  }
}
