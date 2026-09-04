import { and, eq, gt, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@campusos/db';
import { PermissionSet, type Permission } from '@campusos/core';
import { commentsRead, postsRead } from './schema/communities';

/**
 * Who may do what, asked inside the transaction that is about to rely on it.
 *
 * The answers come from two SQL functions: `auth_effective_permissions`, the
 * identity module's, and `auth_effective_community_permissions`, this module's,
 * which adds the roles held in one community and answers with nothing while
 * banned. Neither this module nor the identity module imports the other; the
 * functions are the shared contract.
 */

export type Refusal =
  | 'not_verified'
  | 'not_allowed'
  | 'banned'
  | 'not_found'
  | 'locked'
  | 'archived'
  | 'kind_not_allowed'
  | 'anonymous_not_allowed'
  | 'rate_limited'
  | 'invalid'
  | 'exists'
  | 'depth'
  | 'self'
  | 'self_vote'
  | 'last_owner'
  | 'muted'
  | 'pin_cap'
  | 'closed'
  | 'rules_not_accepted'
  // Participation gates (§12). The numbers behind these come from
  // `describeGate`, on the failure path only.
  | 'gate_karma'
  | 'gate_account_age';

function toSet(rows: unknown[]): PermissionSet {
  return new PermissionSet(
    (rows as { permission?: string }[])
      .map((r) => r.permission)
      .filter((p): p is string => typeof p === 'string'),
  );
}

/** Tenant wide permissions, from the identity module's function. */
export async function tenantPermissions(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<PermissionSet> {
  return toSet([
    ...(await tx.execute(
      sql`select permission from auth_effective_permissions(${userId}::uuid, ${tenantId})`,
    )),
  ]);
}

/** Permissions in one community: tenant wide plus the roles held there, none while banned. */
export async function communityPermissions(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string,
): Promise<PermissionSet> {
  return toSet([
    ...(await tx.execute(
      sql`select permission from auth_effective_community_permissions(${userId}::uuid, ${tenantId}, ${communityId}::uuid)`,
    )),
  ]);
}

export async function canInTenant(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  permission: Permission,
): Promise<boolean> {
  return (await tenantPermissions(tx, userId, tenantId)).has(permission);
}

export async function canInCommunity(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string,
  permission: Permission,
): Promise<boolean> {
  return (await communityPermissions(tx, userId, tenantId, communityId)).has(permission);
}

/**
 * A verified, active member of the tenant. Read from the person's own
 * membership row under their own context; no import of the identity module.
 */
export async function isVerifiedMember(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from tenant_memberships
      where user_id = ${userId}::uuid and tenant_id = ${tenantId}
        and status = 'active' and verified_at is not null
      limit 1`)),
  ];
  return rows.length > 0;
}

/** An unlifted, unexpired ban here or tenant wide. */
export async function isBanned(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string | null,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from community_bans
      where user_id = ${userId}::uuid and tenant_id = ${tenantId}
        and (community_id is null or community_id = ${communityId}::uuid)
        and lifted_at is null and (until is null or until > now())
      limit 1`)),
  ];
  return rows.length > 0;
}

/** Muted in this community: still a member, silent for a while. */
export async function isMuted(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string,
): Promise<boolean> {
  const rows = [
    ...(await tx.execute(sql`
      select 1 from community_mutes
      where user_id = ${userId}::uuid and tenant_id = ${tenantId}
        and community_id = ${communityId}::uuid
        and lifted_at is null and (until is null or until > now())
      limit 1`)),
  ];
  return rows.length > 0;
}

export const LIMITS = {
  postsPerHour: 5,
  anonymousPostsPerHour: 2,
  commentsPerHour: 30,
  votesPerHour: 200,
  reportsPerHour: 10,
  communitiesPerDay: 2,
} as const;

const hourAgo = () => new Date(Date.now() - 3_600_000);

/** The caller's own posts in the last hour, read through the view so no author column is touched. */
export async function ownPostsLastHour(
  tx: TenantTransaction,
  tenantId: string,
  anonymousOnly = false,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(postsRead)
    .where(
      and(
        eq(postsRead.tenantId, tenantId),
        eq(postsRead.isOwn, true),
        gt(postsRead.createdAt, hourAgo()),
        anonymousOnly ? eq(postsRead.isAnonymous, true) : undefined,
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function ownCommentsLastHour(
  tx: TenantTransaction,
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(commentsRead)
    .where(
      and(
        eq(commentsRead.tenantId, tenantId),
        eq(commentsRead.isOwn, true),
        gt(commentsRead.createdAt, hourAgo()),
      ),
    );
  return rows[0]?.n ?? 0;
}
