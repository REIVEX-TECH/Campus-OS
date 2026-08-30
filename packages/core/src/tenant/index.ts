export {
  tenantConfigSchema,
  brandingSchema,
  seoSchema,
  slugSchema,
  type TenantConfig,
  type TenantConfigInput,
} from './schema';
export { createTenantRegistry, subdomainOf, type TenantRegistry } from './registry';
