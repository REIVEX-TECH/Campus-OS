import type { z } from 'zod';
import type { TenantConfig } from '@campusos/core/tenant';
import { describeGate, type GateAction } from '@campusos/module-communities/gates';
import type { Refusal } from '@campusos/module-communities/access';
import type { CommunitiesSettings } from '@campusos/module-communities/manifest';
import type { Actor } from '@campusos/module-identity/sessions';
import { currentActor } from './auth';
import { communitiesEnabled, communitiesSettings } from './communities';
import { clientKey, rateLimit } from './rate-limit';
import { readJson } from './read-json';
import { isSameOrigin } from './same-origin';
import { getTenantRegistry } from './tenants';

/**
 * The gate every communities mutation route passes through, in one place so
 * the routes cannot disagree: same origin and the per client limit on every
 * caller, 401 signed out (these are a person's own actions, not an admin
 * surface), the body validated, the tenant resolved from it (middleware does
 * not run on /api, and naming a tenant grants nothing), and 404 for a tenant
 * that has not enabled the module. The module re-checks every permission
 * inside its own transaction.
 */

export type Gate<T> =
  | { ok: true; actor: Actor; tenant: TenantConfig; settings: CommunitiesSettings; data: T }
  | { ok: false; response: Response };

export async function communityGate<S extends z.ZodTypeAny>(
  request: Request,
  key: string,
  perMinute: number,
  schema: S,
): Promise<Gate<z.infer<S>>> {
  if (!isSameOrigin(request.headers)) {
    return { ok: false, response: Response.json({ error: 'origin' }, { status: 403 }) };
  }
  if (!rateLimit(`communities-${key}:${clientKey(request.headers)}`, perMinute, 60_000)) {
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
  if (!tenant || !communitiesEnabled(tenant)) {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { ok: true, actor, tenant, settings: communitiesSettings(tenant), data: parsed.data };
}

const STATUS: Record<Refusal, number> = {
  not_verified: 403,
  not_allowed: 403,
  banned: 403,
  not_found: 404,
  locked: 409,
  archived: 409,
  kind_not_allowed: 400,
  anonymous_not_allowed: 400,
  rate_limited: 429,
  invalid: 400,
  exists: 409,
  depth: 400,
  self: 409,
  self_vote: 409,
  last_owner: 409,
  muted: 403,
  pin_cap: 409,
  closed: 409,
  rules_not_accepted: 409,
  gate_karma: 403,
  gate_account_age: 403,
};

/** A module refusal as a response: the reason by name, a status the client can branch on. */
export function refusalResponse(error: Refusal, detail?: { need: number; have: number }): Response {
  return Response.json({ error, ...detail }, { status: STATUS[error] ?? 400 });
}

/**
 * The same, but a participation gate carries its numbers.
 *
 * "You need 50 karma to post here, and you have 12" is a better thing to read
 * than "you cannot post here". The extra read happens only when somebody was
 * actually refused, so an ordinary write pays nothing for it.
 */
export async function refusalWithGate(
  error: Refusal,
  where: {
    actor: { userId: string };
    tenant: string;
    communityId: string;
    action: GateAction;
    settings: CommunitiesSettings;
  },
): Promise<Response> {
  if (error !== 'gate_karma' && error !== 'gate_account_age') return refusalResponse(error);
  const detail = await describeGate(
    where.actor,
    where.tenant,
    where.communityId,
    where.action,
    where.settings,
    error,
  );
  return refusalResponse(error, detail ?? undefined);
}
