import { SYSTEM_ROLES } from '@campusos/core';
import type { MessageKey, Translate } from './i18n';

/**
 * How a role is named on screen. A built in role is translated like any other
 * string; a role of the tenant's own is tenant data and shown as they named it.
 */
export function roleDisplayName(
  role: { key: string; isSystem: boolean; name: string },
  t: Translate,
): string {
  return role.isSystem && role.key in SYSTEM_ROLES
    ? t(`admin.members.role.${role.key}` as MessageKey)
    : role.name;
}
