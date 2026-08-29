import { sql } from 'drizzle-orm';
import { db, type Db } from './client';

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
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
