import { and, eq, inArray, sql } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import {
  PermissionSet,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  isCommunityRole,
  isPermission,
  type Permission,
} from '@campusos/core';
import { recordAudit } from './audit';
import { membershipRoles, rolePermissions, roles, tenantMemberships } from './schema/identity';

/**
 * Roles and permissions, per tenant.
 *
 * A person may hold several roles in a tenant and their effective permissions
 * are the union. Reading those permissions goes through a definer function
 * because the alternative, letting anyone holding a tenant context read the
 * role tables, would turn every permission check into a way to read everyone
 * else's roles. Writing them needs a tenant context, which only server code
 * sets, and the application checks `manage-roles` before it does.
 */

export interface Role {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
}

/**
 * What this person may do in this tenant.
 *
 * Empty for a stranger, a suspended member, or a member with no roles: the
 * function answers for one user and one tenant and nothing else, so a caller
 * cannot accidentally ask a broader question than it meant to.
 */
export async function effectivePermissions(
  userId: string,
  tenantId: string,
): Promise<PermissionSet> {
  const rows = [
    ...(await getDb().execute(
      sql`select permission from auth_effective_permissions(${userId}::uuid, ${tenantId})`,
    )),
  ] as { permission?: string }[];
  return new PermissionSet(
    rows.map((r) => r.permission).filter((p): p is string => typeof p === 'string'),
  );
}

/** Whether this person holds one permission here. The common case. */
export async function can(
  userId: string,
  tenantId: string,
  permission: Permission,
): Promise<boolean> {
  return (await effectivePermissions(userId, tenantId)).has(permission);
}

/**
 * The same question, inside a transaction that is about to rely on the answer.
 *
 * Every mutation re-checks with this: the page gate is the first of two checks
 * and never the only one, so a stale render cannot authorise a write.
 */
export async function canInTransaction(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  permission: Permission,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(
      sql`select permission from auth_effective_permissions(${userId}::uuid, ${tenantId})`,
    )),
  ] as { permission?: string }[];
  return rows.some((r) => r.permission === permission);
}

/** Every role a tenant has, with what each one can do. Needs a tenant context. */
export async function listRoles(actorUserId: string, tenantId: string): Promise<Role[]> {
  return withActorInTenant(actorUserId, tenantId, async (tx) => {
    const roleRows = await tx.select().from(roles).where(eq(roles.tenantId, tenantId));
    if (roleRows.length === 0) return [];
    const permissionRows = await tx
      .select()
      .from(rolePermissions)
      .where(
        inArray(
          rolePermissions.roleId,
          roleRows.map((r) => r.id),
        ),
      );
    return roleRows
      .map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        isSystem: r.isSystem,
        permissions: permissionRows
          .filter((p) => p.roleId === r.id)
          .map((p) => p.permission)
          .filter(isPermission),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** The roles one member holds. Needs a tenant context. */
export async function rolesForMember(
  actorUserId: string,
  tenantId: string,
  memberUserId: string,
): Promise<string[]> {
  return withActorInTenant(actorUserId, tenantId, async (tx) => {
    const rows = await tx
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(membershipRoles.tenantId, tenantId), eq(membershipRoles.userId, memberUserId)));
    return rows.map((r) => r.key).sort();
  });
}

/**
 * Create a tenant's system roles if they are missing.
 *
 * Called when a tenant is created, and safe to call again: a tenant that already
 * has them is left alone. This is what lets a new tenant administer itself from
 * the first moment.
 */
export async function ensureSystemRoles(tx: TenantTransaction, tenantId: string): Promise<void> {
  for (const key of SYSTEM_ROLE_KEYS) {
    const definition = SYSTEM_ROLES[key];
    const [role] = await tx
      .insert(roles)
      .values({ tenantId, key, name: definition.name, isSystem: true })
      .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
      .returning();
    const roleId =
      role?.id ??
      (
        await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
      )[0]?.id;
    if (!roleId) throw new Error(`system role ${key} vanished for ${tenantId}`);
    for (const permission of definition.permissions) {
      await tx
        .insert(rolePermissions)
        .values({ roleId, tenantId, permission })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permission] });
    }
  }
}

export type RoleGrantRefusal = 'not_allowed' | 'no_such_role' | 'no_such_member';

/**
 * Give a member a role, or take one away.
 *
 * The actor's `manage-roles` permission is re-checked inside the transaction
 * that does the work, so the page that offered the control cannot be what
 * authorises it. Both directions are idempotent: granting a role twice, or
 * revoking one that is not held, changes nothing and says so.
 */
export async function grantRole(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  roleKey: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal }> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-roles'))) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }
    // Community roles attach per community, never to a tenant membership.
    if (isCommunityRole(roleKey)) return { ok: false as const, reason: 'no_such_role' as const };
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)));
    if (!role) return { ok: false as const, reason: 'no_such_role' as const };

    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, memberUserId)),
      );
    if (!membership) return { ok: false as const, reason: 'no_such_member' as const };

    const [inserted] = await tx
      .insert(membershipRoles)
      .values({
        membershipId: membership.id,
        roleId: role.id,
        tenantId,
        userId: memberUserId,
        grantedBy: actor.userId,
      })
      .onConflictDoNothing({ target: [membershipRoles.membershipId, membershipRoles.roleId] })
      .returning();
    if (!inserted) return { ok: true as const, changed: false };

    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: 'role.granted',
      targetType: 'membership',
      targetId: membership.id,
      meta: { role: roleKey, targetUserId: memberUserId },
    });
    return { ok: true as const, changed: true };
  });
}

export async function revokeRole(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  roleKey: string,
): Promise<
  { ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal | 'last_admin' }
> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-roles'))) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }
    // Community roles attach per community, never to a tenant membership.
    if (isCommunityRole(roleKey)) return { ok: false as const, reason: 'no_such_role' as const };
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)));
    if (!role) return { ok: false as const, reason: 'no_such_role' as const };

    // A tenant must keep at least one person who can administer it, or it locks
    // itself out and only a platform admin could put it right.
    if (roleKey === 'tenant_admin') {
      const [counted] = await tx
        .select({ holders: sql<number>`count(*)::int` })
        .from(membershipRoles)
        .where(and(eq(membershipRoles.tenantId, tenantId), eq(membershipRoles.roleId, role.id)));
      if ((counted?.holders ?? 0) <= 1)
        return { ok: false as const, reason: 'last_admin' as const };
    }

    const deleted = await tx
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.tenantId, tenantId),
          eq(membershipRoles.userId, memberUserId),
          eq(membershipRoles.roleId, role.id),
        ),
      )
      .returning();
    if (deleted.length === 0) return { ok: true as const, changed: false };

    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: 'role.revoked',
      targetType: 'membership',
      targetId: deleted[0]!.membershipId,
      meta: { role: roleKey, targetUserId: memberUserId },
    });
    return { ok: true as const, changed: true };
  });
}

/**
 * Attach a role to a membership without an actor, for the paths that create a
 * membership in the first place: the domain check at sign in and the configured
 * admin list. Must run inside an existing tenant context.
 */
export async function attachRole(
  tx: TenantTransaction,
  input: { membershipId: string; tenantId: string; userId: string; roleKey: string },
): Promise<void> {
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.key, input.roleKey)));
  if (!role) return;
  await tx
    .insert(membershipRoles)
    .values({
      membershipId: input.membershipId,
      roleId: role.id,
      tenantId: input.tenantId,
      userId: input.userId,
    })
    .onConflictDoNothing({ target: [membershipRoles.membershipId, membershipRoles.roleId] });
}

/** Every permission held by anyone, for a member list. Read as the member. */
export async function ownPermissions(userId: string, tenantId: string): Promise<PermissionSet> {
  return withActor(userId, async () => effectivePermissions(userId, tenantId));
}

/** The shape of a key a tenant's own role gets: lower case words joined by hyphens. */
export const ROLE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The key a new role takes from its name: "Course Rep" becomes "course-rep". */
export function roleKeyFromName(name: string): string | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return ROLE_KEY_PATTERN.test(key) ? key : null;
}

export type RoleDefineRefusal =
  'not_allowed' | 'bad_name' | 'exists' | 'no_such_role' | 'system_role';

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

/**
 * Create a role of the tenant's own, with the permissions it starts with.
 *
 * The key comes from the name and can never collide with a system role's,
 * which use underscores. `manage-roles` is re-checked inside the transaction.
 * The insert is a no-op on conflict rather than an error, so two admins
 * creating the same role at once produce one role and one refusal instead of
 * an aborted transaction.
 */
export async function createRole(
  actor: { userId: string },
  tenantId: string,
  input: { name: string; permissions: readonly string[] },
): Promise<{ ok: true; role: Role } | { ok: false; reason: RoleDefineRefusal }> {
  const name = input.name.trim();
  const key = roleKeyFromName(name);
  if (!key || name.length > 60) return { ok: false, reason: 'bad_name' };
  const permissions = unique(input.permissions.filter(isPermission));
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-roles'))) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }
    const [inserted] = await tx
      .insert(roles)
      .values({ tenantId, key, name })
      .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
      .returning();
    if (!inserted) return { ok: false as const, reason: 'exists' as const };
    for (const permission of permissions) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: inserted.id, tenantId, permission })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permission] });
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: 'role.created',
      targetType: 'role',
      targetId: inserted.id,
      meta: { key, permissions: permissions.join(',') },
    });
    return {
      ok: true as const,
      role: { id: inserted.id, key, name, isSystem: false, permissions },
    };
  });
}

/**
 * Replace what one of the tenant's own roles may do. System roles are refused:
 * `tenant_admin` holding every permission is what keeps a tenant able to
 * administer itself. Idempotent when nothing would change.
 */
export async function setRolePermissions(
  actor: { userId: string },
  tenantId: string,
  roleKey: string,
  permissions: readonly string[],
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: RoleDefineRefusal }> {
  const wanted = unique(permissions.filter(isPermission));
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-roles'))) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)));
    if (!role) return { ok: false as const, reason: 'no_such_role' as const };
    if (role.isSystem) return { ok: false as const, reason: 'system_role' as const };

    const current = (
      await tx
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id))
    ).map((r) => r.permission);
    const toAdd = wanted.filter((p) => !current.includes(p));
    const toRemove = current.filter((p) => !(wanted as string[]).includes(p));
    if (toAdd.length === 0 && toRemove.length === 0) {
      return { ok: true as const, changed: false };
    }

    for (const permission of toAdd) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: role.id, tenantId, permission })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permission] });
    }
    if (toRemove.length > 0) {
      await tx
        .delete(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, role.id), inArray(rolePermissions.permission, toRemove)),
        );
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: 'role.changed',
      targetType: 'role',
      targetId: role.id,
      meta: { key: roleKey, permissions: wanted.join(',') },
    });
    return { ok: true as const, changed: true };
  });
}
