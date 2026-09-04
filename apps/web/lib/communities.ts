import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import { settingsSchema, type CommunitiesSettings } from '@campusos/module-communities/manifest';

/**
 * The communities module, as one tenant sees it. A tenant that has not enabled
 * the module has no communities pages, no nav item and runs no query; the
 * settings come from the tenant's config, validated by the module's own schema.
 */

export const COMMUNITIES = 'communities';

export function communitiesEnabled(tenant: TenantConfig): boolean {
  return tenant.enabledModules.includes(COMMUNITIES);
}

/** For a page: 404 when the tenant has not enabled the module. */
export function requireCommunities(tenant: TenantConfig): void {
  if (!communitiesEnabled(tenant)) notFound();
}

export function communitiesSettings(tenant: TenantConfig): CommunitiesSettings {
  return settingsSchema.parse(tenant.moduleSettings[COMMUNITIES] ?? {});
}

/** A stable hue from a seed, for a community's generated banner. */
export function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
