import type { Permission, PermissionSet } from '@campusos/core';
import type { MessageKey } from './i18n';

/**
 * The tenant admin area, section by section, each behind one permission.
 *
 * The one list every admin surface reads: the nav shows the sections the
 * signed in person may use, the bare `/admin` entry forwards to the first of
 * them, and the account page links there. A person with none of these
 * permissions has no admin area at all, and nothing here says otherwise.
 */

export type AdminSectionKey = 'verification' | 'members' | 'roles' | 'rooms' | 'analytics';

export interface AdminSection {
  key: AdminSectionKey;
  permission: Permission;
  /** Relative to the tenant base. */
  path: string;
  label: MessageKey;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    key: 'verification',
    permission: 'approve-verifications',
    path: '/admin/verification',
    label: 'admin.nav.verification',
  },
  {
    key: 'members',
    permission: 'manage-members',
    path: '/admin/members',
    label: 'admin.nav.members',
  },
  { key: 'roles', permission: 'manage-roles', path: '/admin/roles', label: 'admin.nav.roles' },
  { key: 'rooms', permission: 'manage-rooms', path: '/admin/rooms', label: 'admin.nav.rooms' },
  {
    key: 'analytics',
    permission: 'view-analytics',
    path: '/admin/analytics',
    label: 'admin.nav.analytics',
  },
];

/** The sections this person may open, in display order. */
export function visibleAdminSections(permissions: PermissionSet): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => permissions.has(s.permission));
}

/** Where `/admin` lands for this person, or null when there is nowhere to go. */
export function firstAdminSection(permissions: PermissionSet): AdminSection | null {
  return visibleAdminSections(permissions)[0] ?? null;
}
