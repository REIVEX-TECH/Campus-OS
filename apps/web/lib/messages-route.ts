import type { z } from 'zod';
import type { TenantConfig } from '@campusos/core/tenant';
import type { MessagesSettings } from '@campusos/module-messages/manifest';
import type { Actor } from '@campusos/module-identity/sessions';
import { currentActor } from './auth';
import { messagesEnabled, messagesSettings } from './messages';
import { clientKey, rateLimit } from './rate-limit';
import { readJson } from './read-json';
import { isSameOrigin } from './same-origin';
import { getTenantRegistry } from './tenants';

/**
 * The gate every messages JSON mutation route passes through: same origin, a
 * per-client rate limit, signed in, the body validated, the tenant resolved from
 * it (naming a tenant grants nothing), and the module enabled. The module
 * re-checks membership, the who-can-message policy, and participation inside its
 * own transaction.
 */
export type Gate<T> =
  | { ok: true; actor: Actor; tenant: TenantConfig; settings: MessagesSettings; data: T }
  | { ok: false; response: Response };

export async function messagesGate<S extends z.ZodTypeAny>(
  request: Request,
  key: string,
  perMinute: number,
  schema: S,
): Promise<Gate<z.infer<S>>> {
  if (!isSameOrigin(request.headers)) {
    return { ok: false, response: Response.json({ error: 'origin' }, { status: 403 }) };
  }
  if (!rateLimit(`messages-${key}:${clientKey(request.headers)}`, perMinute, 60_000)) {
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
  if (!tenant || !messagesEnabled(tenant)) {
    return { ok: false, response: Response.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { ok: true, actor, tenant, settings: messagesSettings(tenant), data: parsed.data };
}

/** Map a module refusal to an HTTP status. */
export const MESSAGES_STATUS: Record<string, number> = {
  not_allowed: 403,
  not_verified: 403,
  recipient_unavailable: 409,
  blocked: 409,
  self: 409,
  invalid: 400,
  rate_limited: 429,
  declined_recently: 409,
  not_found: 404,
  not_pending: 409,
  not_recipient: 403,
  too_late: 409,
  exists: 409,
};

export function refusalResponse(reason: string): Response {
  return Response.json({ error: reason }, { status: MESSAGES_STATUS[reason] ?? 400 });
}
