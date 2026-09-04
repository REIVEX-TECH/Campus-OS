import { z } from 'zod';
import { appeal } from '@campusos/module-identity/standing';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

/**
 * The one note a restricted or suspended person may leave about it.
 *
 * Their own membership row, so it needs no permission beyond being signed in
 * and being under a standing: someone in good standing has nothing to appeal.
 */
export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  note: z.string(),
});

const STATUS: Record<string, number> = {
  invalid: 400,
  not_found: 404,
  not_restricted: 409,
  not_allowed: 403,
  self: 409,
  last_admin: 409,
};

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: 'origin' }, { status: 403 });
  }
  if (!rateLimit(`appeal:${clientKey(request.headers)}`, 5, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 });

  const result = await appeal({ userId: actor.userId }, tenant.slug, parsed.data.note);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  }
  return Response.json(result.value);
}
