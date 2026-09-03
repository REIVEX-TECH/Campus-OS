import { createTenantRegistry } from '@campusos/core/tenant';
import { lgu } from './lgu/tenant.config';

/**
 * The tenant registry. Add a university by dropping a `tenant.config.ts` in a new
 * folder and listing it here — no core changes required. Configs are validated at
 * load; an invalid one throws.
 */
/** The file configs, raw, for the database backed registry to merge over. */
export const fileTenantConfigs = [lgu];

export const tenantRegistry = createTenantRegistry(fileTenantConfigs);

export { lgu };
