import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  withActor,
  withActorInTenant,
  withTenantMutation,
  type TenantTransaction,
  type TenantWriteContext,
} from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { PermissionSet, isCommunityRole, isPermission, type Permission } from '@campusos/core';
import { syncTenantRoles } from './role-templates';
import { membershipRoles, rolePermissions, roles } from './schema/identity';

/**
 * Roles and permissions, per tenant.
 *
 * A person may hold several roles in a tenant and their effective permissions
 * are the union. Reading those permissions goes through a definer function
 * because the alternative, letting anyone holding a tenant context read the
 * role tables, would turn every permission check into a way to read everyone
 * else's roles.
 *
 * Which roles exist and what each carries is a platform level definition
 * (`role-templates.ts`); a tenant's rows are materialisations of it, and
 * `manage-roles` here means assigning and revoking, never defining.
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

/** The whole set, inside a transaction, for the checks that compare sets rather than ask about one. */
export async function effectivePermissionsInTransaction(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<Set<string>> {
  const rows = [
    ...(await tx.execute(
      sql`select permission from auth_effective_permissions(${userId}::uuid, ${tenantId})`,
    )),
  ] as { permission?: string }[];
  return new Set(rows.map((r) => r.permission).filter((p): p is string => typeof p === 'string'));
}

/**
 * Every role a tenant has, with what each one can do. Needs a tenant context.
 *
 * Intentionally not gated on a single permission: the catalogue is not per-user
 * data but a materialisation of the platform templates, tenant-scoped by the
 * `roles_read_in_tenant` policy (0013), and read legitimately by a resident admin
 * (manage-roles OR manage-members) AND by a platform admin verifying a definition
 * reached the tenant. Tenant-context RLS is the right boundary here; a
 * per-permission gate would wrongly hide it from those callers.
 */
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

/**
 * The roles one member holds. Needs a tenant context.
 *
 * A specific member's assignments are a roster/role-management read, so this gates
 * in the function itself -- not only at the caller -- on manage-roles OR
 * manage-members, and returns empty for anyone else, rather than leaning on
 * tenant-context RLS alone the way listRoles (a non-sensitive catalogue) can.
 */
export async function rolesForMember(
  actorUserId: string,
  tenantId: string,
  memberUserId: string,
): Promise<string[]> {
  return withActorInTenant(actorUserId, tenantId, async (tx) => {
    const perms = await effectivePermissionsInTransaction(tx, actorUserId, tenantId);
    if (!perms.has('manage-roles') && !perms.has('manage-members')) return [];
    const rows = await tx
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(membershipRoles.tenantId, tenantId), eq(membershipRoles.userId, memberUserId)));
    return rows.map((r) => r.key).sort();
  });
}

/**
 * Give a tenant the roles the definitions say it has.
 *
 * Called when a tenant is created and again whenever a membership is made, and
 * safe to call any number of times. The write goes through a definer function
 * because the tenant role tables are writable only by a platform administrator
 * now, and none of these paths has one: a person signing in is not an
 * administrator of anything.
 */
export async function ensureSystemRoles(tx: TenantTransaction, tenantId: string): Promise<void> {
  await syncTenantRoles(tx, tenantId);
}

export type RoleGrantRefusal = 'not_allowed' | 'no_such_role' | 'no_such_member' | 'above_own';

/**
 * Give a member a role, or take one away.
 *
 * The actor's `manage-roles` permission is re-checked inside the transaction
 * that does the work, so the page that offered the control cannot be what
 * authorises it. Both directions are idempotent: granting a role twice, or
 * revoking one that is not held, changes nothing and says so.
 */
/** Map the definer's outcome code to the Result the callers expect. */
function roleOutcome(
  code: string,
): { ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal | 'last_admin' } {
  switch (code) {
    case 'changed':
      return { ok: true, changed: true };
    case 'unchanged':
      return { ok: true, changed: false };
    case 'not_allowed':
    case 'no_such_role':
    case 'no_such_member':
    case 'above_own':
    case 'last_admin':
      return { ok: false, reason: code };
    default:
      return { ok: false, reason: 'not_allowed' };
  }
}

export async function grantRole(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  roleKey: string,
  access?: TenantWriteContext,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal }> {
  // Community roles attach per community, never to a tenant membership, and are
  // rejected here before the definer, which would otherwise find the synced row
  // in `roles` and treat it as grantable.
  if (isCommunityRole(roleKey)) return { ok: false, reason: 'no_such_role' };
  // The write, and every check — manage-roles, no-power-above-your-own, the
  // platform exemption that keeps communities.unmask grantable (reachable only
  // under a live grant, 0029), and the "not yourself under a grant" containment —
  // is `auth_set_membership_role` (0019); the application role can no longer write
  // membership_roles directly.
  const outcome = await withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select auth_set_membership_role(${tenantId}, ${memberUserId}::uuid, ${roleKey}, true) as code`,
      )),
    ] as { code: string }[];
    return roleOutcome(row?.code ?? 'not_allowed');
  });
  // grantRole cannot report last_admin (that is a revoke-only refusal).
  return outcome.ok || outcome.reason !== 'last_admin'
    ? (outcome as { ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal })
    : { ok: false, reason: 'not_allowed' };
}

export async function revokeRole(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  roleKey: string,
  access?: TenantWriteContext,
): Promise<
  { ok: true; changed: boolean } | { ok: false; reason: RoleGrantRefusal | 'last_admin' }
> {
  if (isCommunityRole(roleKey)) return { ok: false, reason: 'no_such_role' };
  return withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select auth_set_membership_role(${tenantId}, ${memberUserId}::uuid, ${roleKey}, false) as code`,
      )),
    ] as { code: string }[];
    return roleOutcome(row?.code ?? 'not_allowed');
  });
}

/** Every permission held by anyone, for a member list. Read as the member. */
export async function ownPermissions(userId: string, tenantId: string): Promise<PermissionSet> {
  return withActor(userId, async () => effectivePermissions(userId, tenantId));
}

export interface FoundMember {
  userId: string;
  handle: string;
  isVerified: boolean;
  roles: string[];
}

/**
 * Find a member of this tenant by their email, for the roles UI.
 *
 * A privileged read (auth_find_member_by_email, 0026): manage-roles required, it
 * resolves an email ONLY to a member of THIS tenant (nothing for a stranger or a
 * cross-tenant account), and returns the handle and role keys, never the email.
 * Runs in the write context so a platform admin's grant is assumed and the
 * definer's authority check resolves; a resident admin uses their own membership.
 */
export async function findMemberByEmail(
  actor: { userId: string },
  tenantId: string,
  email: string,
  access?: TenantWriteContext,
): Promise<FoundMember | null> {
  return withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select user_id, handle, is_verified, roles
            from auth_find_member_by_email(${tenantId}, ${email})`,
      )),
    ] as { user_id: string; handle: string; is_verified: boolean; roles: string[] }[];
    return row
      ? { userId: row.user_id, handle: row.handle, isVerified: row.is_verified, roles: row.roles }
      : null;
  });
}

export interface MemberIdentity {
  userId: string;
  handle: string | null;
  avatarSeed: string;
  /** Captured at verification from the request detail; null for a member who submitted none. */
  fullName: string | null;
  rollNumber: string | null;
  /** The live sign-in email — the one identifier every member has. */
  email: string;
  capturedVia: string | null;
  capturedAt: Date | null;
}

/**
 * Reveal one member's real identity — name, roll number, sign-in email — for the
 * admin members page.
 *
 * A deliberately narrow, audited read (auth_member_identity, 0031): the actor must
 * hold view-member-identity, the target must be a member of THIS tenant (nothing
 * for a stranger or a cross-tenant account), and every authorized reveal writes a
 * `member.identity_viewed` audit line. Runs in the write context so a platform
 * admin's grant is assumed and the definer's authority check resolves; a resident
 * admin uses their own membership. Name/roll are null for a member who was
 * verified without submitting them (a domain self-verify); the email is always
 * present.
 */
export async function revealMemberIdentity(
  actor: { userId: string },
  tenantId: string,
  targetUserId: string,
  access?: TenantWriteContext,
): Promise<MemberIdentity | null> {
  return withTenantMutation(actor.userId, tenantId, access, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select user_id, handle, avatar_seed, full_name, roll_number, email, captured_via, captured_at
            from auth_member_identity(${tenantId}, ${targetUserId}::uuid)`,
      )),
    ] as {
      user_id: string;
      handle: string | null;
      avatar_seed: string;
      full_name: string | null;
      roll_number: string | null;
      email: string;
      captured_via: string | null;
      captured_at: string | Date | null;
    }[];
    if (!row) return null;
    return {
      userId: row.user_id,
      handle: row.handle,
      avatarSeed: row.avatar_seed,
      fullName: row.full_name,
      rollNumber: row.roll_number,
      email: row.email,
      capturedVia: row.captured_via,
      capturedAt:
        row.captured_at === null
          ? null
          : row.captured_at instanceof Date
            ? row.captured_at
            : new Date(row.captured_at),
    };
  });
}
