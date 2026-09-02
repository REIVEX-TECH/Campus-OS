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
