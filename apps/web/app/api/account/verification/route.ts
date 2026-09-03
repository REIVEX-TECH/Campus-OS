import { z } from 'zod';
import { tenantRegistry } from '@campusos/tenants';
import {
  requestVerification,
  verificationDetailsSchema,
} from '@campusos/module-identity/verification';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Ask to be verified in a tenant.
 *
 * Runs as the person, never in a tenant context, so the database refuses
 * anything but their own pending request. The details are checked here for
 * shape and in the module for policy (already verified, one open request, the
 * monthly limit); both refusals are reported by name so the form can explain.
 */

export const dynamic = 'force-dynamic';

const bodySchema = verificationDetailsSchema.extend({ tenant: z.string().min(1).max(64) });

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`verification-request:${clientKey(request.headers)}`, 5, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'format' }, { status: 400 });
  const { tenant, ...details } = parsed.data;
  if (!tenantRegistry.resolveBySlug(tenant)) {
    return Response.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  const result = await requestVerification(actor.userId, tenant, details);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ status: result.value.status });
}
