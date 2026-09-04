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
  // Standing: restricting a member to reading, or suspending them outright.
  'restrict-members',
  'manage-roles',
  'view-analytics',
  'post',
  'moderate',
  // Communities. Tenant level: who may create one and who oversees them all.
  'communities.create',
  'communities.oversee',
  // Explicit and audited; held by nobody until a tenant grants it on purpose.
  'communities.unmask',
  // Community level, carried by the community roles, never by tenant roles.
  'communities.post',
  'communities.comment',
  'communities.vote',
  'communities.moderate',
  'communities.flairs',
  'communities.manage',
  'communities.transfer',
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
  student: { name: 'Student', permissions: ['post', 'communities.create'] },
  teacher: { name: 'Teacher', permissions: ['post', 'communities.create'] },
  // Everything except unmasking an anonymous author, which is never a default:
  // a tenant grants it explicitly, and that grant is itself audited.
  tenant_admin: {
    name: 'Administrator',
    permissions: PERMISSIONS.filter((p) => p !== 'communities.unmask'),
  },
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

/**
 * The roles a community attaches to its members. They live in the same `roles`
 * table as every other role, marked system, but are attached per community
 * (community_member_roles), never to a tenant membership: granting one at
 * tenant scope is refused. The communities module seeds them.
 */
export const COMMUNITY_ROLES = {
  community_member: {
    name: 'Member',
    permissions: ['communities.post', 'communities.comment', 'communities.vote'],
  },
  community_moderator: {
    name: 'Moderator',
    permissions: [
      'communities.post',
      'communities.comment',
      'communities.vote',
      'communities.moderate',
      'communities.flairs',
    ],
  },
  community_owner: {
    name: 'Owner',
    permissions: [
      'communities.post',
      'communities.comment',
      'communities.vote',
      'communities.moderate',
      'communities.flairs',
      'communities.manage',
      'communities.transfer',
    ],
  },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type CommunityRoleKey = keyof typeof COMMUNITY_ROLES;
export const COMMUNITY_ROLE_KEYS = Object.keys(COMMUNITY_ROLES) as CommunityRoleKey[];

/** Whether a role key names a community scoped role. */
export function isCommunityRole(key: string): key is CommunityRoleKey {
  return key in COMMUNITY_ROLES;
}
