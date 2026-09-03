import { and, eq, inArray, sql } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import {
  PermissionSet,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
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
