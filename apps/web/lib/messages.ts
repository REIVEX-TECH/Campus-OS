import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import { settingsSchema, type MessagesSettings } from '@campusos/module-messages/manifest';

/**
 * The direct-messages module, as one tenant sees it. A tenant that has not
 * enabled it has no messages pages, no nav item and runs no query.
 */
export const MESSAGES = 'messages';

export function messagesEnabled(tenant: TenantConfig): boolean {
  return tenant.enabledModules.includes(MESSAGES);
}

/** For a page: 404 when the tenant has not enabled the module. */
export function requireMessages(tenant: TenantConfig): void {
  if (!messagesEnabled(tenant)) notFound();
}

export function messagesSettings(tenant: TenantConfig): MessagesSettings {
  return settingsSchema.parse(tenant.moduleSettings[MESSAGES] ?? {});
}
