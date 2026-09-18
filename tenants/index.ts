import { createTenantRegistry } from '@campusos/core/tenant';
import { lgu } from './lgu/tenant.config';
import { demo } from './demo/tenant.config';

/** The file configs, raw, for the database backed registry to merge over. */
export const fileTenantConfigs = [lgu, demo];

export const tenantRegistry = createTenantRegistry(fileTenantConfigs);

export { lgu, demo };
