import { z } from 'zod';
import { liftStanding, setStanding } from '@campusos/module-identity/standing';
import { permitted } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

/**
 * A member's standing: restricted to reading, suspended outright, or lifted.
 *
 * Behind `restrict-members`, re-checked by the module inside the transaction
 * that writes. 404 rather than 403 to anyone without it, as every admin
 * surface does, so the route never confirms its own existence.
 */
export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
  status: z.enum(['active', 'restricted', 'suspended']),
  reason: z.string().optional(),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .optional(),
});

const STATUS: Record<string, number> = {
  not_allowed: 404,
  not_found: 404,
  self: 409,
  last_admin: 409,
  invalid: 400,
  not_restricted: 409,
};

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: 'origin' }, { status: 403 });
  }
  if (!rateLimit(`standing:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 });
  const gate = await permitted(tenant.slug, 'restrict-members');
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 });

  const { userId, status, reason, minutes } = parsed.data;
  const actor = { userId: gate.actor.userId };
  const result =
    status === 'active'
      ? await liftStanding(actor, tenant.slug, userId)
      : await setStanding(actor, tenant.slug, userId, { status, reason: reason ?? '', minutes });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  }
  return Response.json(result.value);
}
