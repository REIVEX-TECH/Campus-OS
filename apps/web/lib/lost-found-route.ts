import type { z } from 'zod';
import type { TenantConfig } from '@campusos/core/tenant';
import type { LostFoundSettings } from '@campusos/module-lost-found/manifest';
import type { Actor } from '@campusos/module-identity/sessions';
import { currentActor } from './auth';
import { lostFoundEnabled, lostFoundSettings } from './lost-found';
import { clientKey, rateLimit } from './rate-limit';
import { readJson } from './read-json';
import { isSameOrigin } from './same-origin';
import { getTenantRegistry } from './tenants';

/**
 * The gate every Lost & Found JSON mutation route passes through: same origin,
 * a per-client rate limit, signed in, the body validated, the tenant resolved
 * from it (naming a tenant grants nothing), and the module enabled. The module
 * re-checks verification and ownership inside its own transaction.
 */
export type Gate<T> =
  | { ok: true; actor: Actor; tenant: TenantConfig; settings: LostFoundSettings; data: T }
  | { ok: false; response: Response };

export async function lostFoundGate<S extends z.ZodTypeAny>(
  request: Request,
  key: string,
  perMinute: number,
  schema: S,
): Promise<Gate<z.infer<S>>> {
  if (!isSameOrigin(request.headers)) {
    return { ok: false, response: Response.json({ error: 'origin' }, { status: 403 }) };
  }
  if (!rateLimit(`lostfound-${key}:${clientKey(request.headers)}`, perMinute, 60_000)) {
    return { ok: false, response: Response.json({ error: 'rate_limited' }, { status: 429 }) };
  }
  const actor = await currentActor();
  if (!actor) {
    return { ok: false, response: Response.json({ error: 'unauthorised' }, { status: 401 }) };
  }
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) {
    return { ok: false, response: Response.json({ error: 'invalid' }, { status: 400 }) };
  }
  const slug = (parsed.data as { tenant?: unknown }).tenant;
  const tenant = typeof slug === 'string' ? (await getTenantRegistry()).resolveBySlug(slug) : null;
  if (!tenant || !lostFoundEnabled(tenant)) {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { ok: true, actor, tenant, settings: lostFoundSettings(tenant), data: parsed.data };
}

/** Map a module refusal to an HTTP status. */
export const LOST_FOUND_STATUS: Record<string, number> = {
  not_verified: 403,
  not_allowed: 403,
  invalid: 400,
  rate_limited: 429,
  not_found: 404,
  too_many_photos: 409,
  own_item: 409,
  not_open: 409,
  exists: 409,
};

export function refusalResponse(reason: string): Response {
  return Response.json({ error: reason }, { status: LOST_FOUND_STATUS[reason] ?? 400 });
}
