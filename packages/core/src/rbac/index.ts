/**
 * What a role can do.
 *
 * The catalogue is a fixed list in code rather than data, because a permission
 * only means something if some code checks it: an entry here without a guard
 * somewhere is a promise nothing keeps. Roles, which bundle these, ARE data and
 * belong to a tenant.
 */

export const PERMISSIONS = [
  'manage-timetable',
  'manage-rooms',
  'approve-verifications',
  'manage-members',
  'manage-roles',
  'view-analytics',
  'post',
  'moderate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The roles every tenant starts with, and cannot delete.
 *
 * A tenant may add its own; these three exist so a new tenant can administer
 * itself from the first moment, and are marked `is_system` so the role that
 * grants administration cannot be removed by the people relying on it.
 */
export const SYSTEM_ROLES = {
  student: { name: 'Student', permissions: ['post'] },
  teacher: { name: 'Teacher', permissions: ['post'] },
  tenant_admin: { name: 'Administrator', permissions: [...PERMISSIONS] },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

/**
 * A person's effective permissions in one tenant: the union over every role they
 * hold there. Deliberately a set of strings rather than a role name, so callers
 * ask what someone may DO rather than what they are.
 */
export class PermissionSet {
  private readonly held: ReadonlySet<string>;

  constructor(permissions: Iterable<string>) {
    this.held = new Set(permissions);
  }

  has(permission: Permission): boolean {
    return this.held.has(permission);
  }

  /** True when every one of these is held. */
  hasAll(...permissions: Permission[]): boolean {
    return permissions.every((p) => this.held.has(p));
  }

  /** True when at least one is held. */
  hasAny(...permissions: Permission[]): boolean {
    return permissions.some((p) => this.held.has(p));
  }

  get size(): number {
    return this.held.size;
  }

  toArray(): Permission[] {
    return PERMISSIONS.filter((p) => this.held.has(p));
  }
}

export const NO_PERMISSIONS = new PermissionSet([]);
