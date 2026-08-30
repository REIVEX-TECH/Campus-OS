import { withTenant, type TenantTransaction } from '../tenant-context';

/**
 * Base for repositories that operate within a single tenant. A repository
 * cannot be constructed without a tenant id, and every query it runs goes
 * through `run`, which sets the tenant context (so RLS applies).
 */
export abstract class TenantScopedRepository {
  constructor(protected readonly tenantId: string) {}

  protected run<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return withTenant(this.tenantId, fn);
  }
}
