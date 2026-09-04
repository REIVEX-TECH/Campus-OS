import { sql } from 'drizzle-orm';
import { getDb, type Db } from './client';

/** The transaction handle passed to a `withTenant` callback. */
export type TenantTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Run `fn` inside a transaction that has the tenant context set. The context is
 * transaction-local (`set_config(..., true)`), so it is safe on a pooled
 * connection and cannot leak to the next query. With no context set, RLS
 * policies match nothing (default deny).
 */
export function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` with the ACTOR context set: the signed in user. Identity tables are
 * mostly platform level (a person exists above any one university), so they
 * cannot key on `app.tenant_id`; their policies key on `app.user_id` instead.
 * Like the tenant context this is transaction local, so it is safe on a pooled
 * connection, and with nothing set the policies match nothing: default deny.
 */
export function withActor<T>(
  userId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Both contexts at once, for the common case of a signed in user acting inside
 * one tenant: their own rows stay reachable and tenant scoped tables resolve to
 * that tenant. Neither context widens the other; each policy still applies.
 */
export function withActorInTenant<T>(
  userId: string,
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** What opening a platform tenant grant returns: the grant, its tenant, and when it ends. */
export interface PlatformGrant {
  grantId: string;
  tenantId: string;
  expiresAt: Date;
  reason: string;
}

/**
 * Open a cross-tenant grant and run `fn` inside it, as a platform administrator.
 *
 * `auth_open_tenant_grant` (0018) validates that the actor is a platform admin
 * with a live session, writes the opening audit line and the grant row and the
 * first use row, and sets `app.tenant_id` — all in this one transaction, so an
 * unlogged entry cannot happen. Inside `fn` the actor resolves as that tenant's
 * `tenant_admin` minus `communities.unmask`, and cannot write themselves a
 * membership or touch any platform-level table. There may be only one open
 * grant per administrator at a time.
 *
 * This is the first entry. Later requests re-enter the same grant with
 * `withGrantedTenant`, which is the per-request primitive Phase 5B builds on.
 */
export function withPlatformGrant<T>(
  actor: { userId: string; sessionId: string },
  tenantId: string,
  reason: string,
  fn: (tx: TenantTransaction, grant: PlatformGrant) => Promise<T>,
  minutes = 30,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    const rows = [
      ...(await tx.execute(
        sql`select grant_id, tenant_id, expires_at, reason
            from auth_open_tenant_grant(${tenantId}, ${reason}, ${actor.sessionId}::uuid, ${minutes})`,
      )),
    ] as {
      grant_id: string;
      tenant_id: string;
      expires_at: string | Date;
      reason: string;
    }[];
    const row = rows[0];
    if (!row) throw new Error('auth_open_tenant_grant returned no row');
    const grant: PlatformGrant = {
      grantId: row.grant_id,
      tenantId: row.tenant_id,
      expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
      reason: row.reason,
    };
    return fn(tx, grant);
  });
}

/**
 * Re-enter an already-open grant for one transaction, as a platform admin.
 *
 * `auth_assume_tenant_grant` finds the live grant bound to this actor and
 * session, refuses to layer over a different tenant context, writes the use row
 * that proves this transaction is acting under the grant, and sets
 * `app.tenant_id`. Raises if there is no open grant, which the caller maps to a
 * re-open prompt rather than letting it surface as a 500 (Phase 5B).
 */
export function withGrantedTenant<T>(
  actor: { userId: string; sessionId: string },
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    await tx.execute(sql`select auth_assume_tenant_grant(${actor.sessionId}::uuid)`);
    return fn(tx);
  });
}
