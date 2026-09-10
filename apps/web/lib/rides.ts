import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import { settingsSchema, type RidesSettings } from '@campusos/module-rides/manifest';

/**
 * The Rides module, as one tenant sees it. A tenant that has not enabled the module
 * has no rides pages, no nav item and runs no query.
 */
export const RIDES = 'rides';

export function ridesEnabled(tenant: TenantConfig): boolean {
  return tenant.enabledModules.includes(RIDES);
}

/** For a page: 404 when the tenant has not enabled the module. */
export function requireRides(tenant: TenantConfig): void {
  if (!ridesEnabled(tenant)) notFound();
}

export function ridesSettings(tenant: TenantConfig): RidesSettings {
  return settingsSchema.parse(tenant.moduleSettings[RIDES] ?? {});
}
