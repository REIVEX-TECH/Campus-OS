import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import {
  CONDITIONS,
  DEFAULT_CATEGORIES,
  settingsSchema,
  type MarketplaceSettings,
} from '@campusos/module-marketplace/manifest';
import type { MessageKey, Translate } from './i18n';

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

const DEFAULT_CATEGORY_SET = new Set<string>(DEFAULT_CATEGORIES);
const CONDITION_SET = new Set<string>(CONDITIONS);

function humanise(key: string): string {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A display label for a category: the built-in translation, or the key humanised. */
export function categoryLabel(t: Translate, category: string): string {
  return DEFAULT_CATEGORY_SET.has(category)
    ? t(`marketplace.category.${category}` as MessageKey)
    : humanise(category);
}

/** A display label for a condition (always one of the fixed set). */
export function conditionLabel(t: Translate, condition: string): string {
  return CONDITION_SET.has(condition)
    ? t(`marketplace.condition.${condition}` as MessageKey)
    : humanise(condition);
}

/** The category -> label and condition -> label maps for the client components. */
export function categoryLabels(t: Translate, categories: string[]): Record<string, string> {
  return Object.fromEntries(categories.map((c) => [c, categoryLabel(t, c)]));
}

export function conditionLabels(t: Translate): Record<string, string> {
  return Object.fromEntries([...CONDITION_SET].map((c) => [c, conditionLabel(t, c)]));
}
