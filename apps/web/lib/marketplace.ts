import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import { settingsSchema, type MarketplaceSettings } from '@campusos/module-marketplace/manifest';

/**
 * The marketplace module, as one tenant sees it. A tenant that has not enabled it
 * has no marketplace pages, no nav item and runs no query. Services and money are
 * separate flags (marketplace-services); goods is this one.
 */
export const MARKETPLACE = 'marketplace';

export function marketplaceEnabled(tenant: TenantConfig): boolean {
  return tenant.enabledModules.includes(MARKETPLACE);
}

/** For a page: 404 when the tenant has not enabled the module. */
export function requireMarketplace(tenant: TenantConfig): void {
  if (!marketplaceEnabled(tenant)) notFound();
}

export function marketplaceSettings(tenant: TenantConfig): MarketplaceSettings {
  return settingsSchema.parse(tenant.moduleSettings[MARKETPLACE] ?? {});
}
