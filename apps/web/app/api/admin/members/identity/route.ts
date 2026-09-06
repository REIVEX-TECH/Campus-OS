import { z } from 'zod';
import { revealMemberIdentity } from '@campusos/module-identity/rbac';
import { getTenantRegistry } from '@/lib/tenants';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';

/**
 * Reveal one member's real identity (name, roll number, sign-in email).
 *
 * Cheap checks first on every caller, then 404 unless the caller holds
 * `view-member-identity` here; the definer re-checks and audits the look. A
 * tighter per-caller rate limit than a plain read: a reveal is a sensitive,
 * logged action, not something to sweep across the roster.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`admin-identity:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  const write = tenant ? await tenantWriteContext(tenant.slug, 'view-member-identity') : null;
  if (!tenant || !write) return Response.json({ error: 'not_found' }, { status: 404 });

  const identity = await revealMemberIdentity(
    { userId: write.actor.userId },
    tenant.slug,
    parsed.data.userId,
    write.access,
  );
  if (!identity) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({
    fullName: identity.fullName,
    rollNumber: identity.rollNumber,
    email: identity.email,
    capturedVia: identity.capturedVia,
    capturedAt: identity.capturedAt ? identity.capturedAt.toISOString() : null,
  });
}
