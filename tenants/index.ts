import { createTenantRegistry } from '@campusos/core/tenant';
import { lgu } from './lgu/tenant.config';

/**
 * The tenant registry. Add a university by dropping a `tenant.config.ts` in a new
 * folder and listing it here — no core changes required. Configs are validated at
 * load; an invalid one throws.
 */
export const tenantRegistry = createTenantRegistry([lgu]);

export { lgu };
