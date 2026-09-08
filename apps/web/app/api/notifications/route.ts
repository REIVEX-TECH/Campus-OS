import { z } from 'zod';
import { markRead } from '@campusos/module-notifications/inbox';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.literal('read'),
  ids: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(100)]),
});

/**
 * Mark notifications read, across every kind. Not gated on any module: a member may
 * have notifications from a module that is no longer in their sidebar. Own rows only,
 * by RLS.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: 'origin' }, { status: 403 });
  }
  if (!rateLimit(`notifications:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 });
  const result = await markRead({ userId: actor.userId }, tenant.slug, parsed.data.ids);
  return Response.json(result);
}
