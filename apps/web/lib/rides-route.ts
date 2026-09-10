import type { z } from 'zod';
import type { TenantConfig } from '@campusos/core/tenant';
import type { RidesSettings } from '@campusos/module-rides/manifest';
import type { Actor } from '@campusos/module-identity/sessions';
import { currentActor } from './auth';
import { ridesEnabled, ridesSettings } from './rides';
import { clientKey, rateLimit } from './rate-limit';
import { readJson } from './read-json';
import { isSameOrigin } from './same-origin';
import { getTenantRegistry } from './tenants';

/**
 * The gate every rides JSON mutation route passes through: same origin, a per-client
 * rate limit, signed in, the body validated, the tenant resolved from it (naming a
 * tenant grants nothing), and the module enabled. The module re-checks verification,
 * ownership and blocks inside its own transaction.
 */
export type Gate<T> =
  | { ok: true; actor: Actor; tenant: TenantConfig; settings: RidesSettings; data: T }
  | { ok: false; response: Response };

export async function ridesGate<S extends z.ZodTypeAny>(
  request: Request,
  key: string,
  perMinute: number,
  schema: S,
): Promise<Gate<z.infer<S>>> {
  if (!isSameOrigin(request.headers)) {
    return { ok: false, response: Response.json({ error: 'origin' }, { status: 403 }) };
  }
  if (!rateLimit(`rides-${key}:${clientKey(request.headers)}`, perMinute, 60_000)) {
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
  if (!tenant || !ridesEnabled(tenant)) {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { ok: true, actor, tenant, settings: ridesSettings(tenant), data: parsed.data };
}

/** Map a module refusal to an HTTP status. */
export const RIDES_STATUS: Record<string, number> = {
  not_verified: 403,
  not_allowed: 403,
  invalid: 400,
  contact_info: 422,
  seats: 422,
  past: 422,
  rate_limited: 429,
  not_found: 404,
  own_ride: 409,
  blocked: 409,
  exists: 409,
  not_pending: 409,
  not_cancellable: 409,
  not_completed: 409,
  not_eligible: 403,
};

export function refusalResponse(reason: string): Response {
  return Response.json({ error: reason }, { status: RIDES_STATUS[reason] ?? 400 });
}
