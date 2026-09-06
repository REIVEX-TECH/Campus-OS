import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import {
  DEFAULT_CATEGORIES,
  settingsSchema,
  type LostFoundSettings,
} from '@campusos/module-lost-found/manifest';
import type { MessageKey, Translate } from './i18n';

/**
 * The Lost & Found module, as one tenant sees it. A tenant that has not enabled
 * the module has no Lost & Found pages, no nav item and runs no query.
 */
export const LOST_FOUND = 'lost-found';

export function lostFoundEnabled(tenant: TenantConfig): boolean {
  return tenant.enabledModules.includes(LOST_FOUND);
}

/** For a page: 404 when the tenant has not enabled the module. */
export function requireLostFound(tenant: TenantConfig): void {
  if (!lostFoundEnabled(tenant)) notFound();
}

export function lostFoundSettings(tenant: TenantConfig): LostFoundSettings {
  return settingsSchema.parse(tenant.moduleSettings[LOST_FOUND] ?? {});
}

const DEFAULT_CATEGORY_SET = new Set<string>(DEFAULT_CATEGORIES);

/** A display label for a category: the built-in translation, or the raw key humanised. */
export function categoryLabel(t: Translate, category: string): string {
  if (DEFAULT_CATEGORY_SET.has(category)) {
    return t(`lostFound.category.${category}` as MessageKey);
  }
  return category.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
