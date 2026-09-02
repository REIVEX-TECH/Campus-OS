export {
  joinModeSchema,
  tenantConfigSchema,
  brandingSchema,
  seoSchema,
  slugSchema,
  type JoinMode,
  type TenantConfig,
  type TenantConfigInput,
} from './schema';
export { createTenantRegistry, subdomainOf, type TenantRegistry } from './registry';
