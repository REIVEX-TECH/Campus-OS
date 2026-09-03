import { and, eq, sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { recordAudit } from './audit';
import type { VerificationMethod } from './membership';
import { canInTransaction } from './rbac';
import { membershipRoles, roles, tenantMemberships } from './schema/identity';

/**
 * The member list, and the one thing a member manager does to a membership
 * that is not a role: suspend it, or lift the suspension.
 *
 * Both need `manage-members`, re-checked inside the transaction that does the
 * work. Handles only: nothing here reads an email.
 */

export type MemberStatus = 'active' | 'suspended';

export interface MemberSummary {
  userId: string;
  handle: string | null;
  avatarSeed: string;
  /** Keys of the roles held here, sorted. What the permission checks read. */
  roles: string[];
  status: string;
  verifiedAt: Date | null;
  verificationMethod: VerificationMethod | null;
  createdAt: Date;
}

/** Every member, newest first, each with the roles they hold. */
export async function listMembers(
  actor: { userId: string },
  tenantId: string,
  limit = 200,
): Promise<Result<MemberSummary[], 'not_allowed'>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-members'))) {
      return err('not_allowed');
    }
    const rows = [
      ...(await tx.execute(sql`
        select m.user_id, p.handle, coalesce(p.avatar_seed, m.user_id::text) as avatar_seed,
               m.status, m.verified_at, m.verification_method, m.created_at,
               coalesce(
                 (select array_agg(r.key order by r.key)
                    from membership_roles mr
                    join roles r on r.id = mr.role_id
                   where mr.membership_id = m.id),
                 '{}'
               ) as role_keys
        from tenant_memberships m
        left join public_profiles p on p.user_id = m.user_id
        where m.tenant_id = ${tenantId}
        order by m.created_at desc
        limit ${limit}`)),
    ] as {
      user_id: string;
      handle: string | null;
      avatar_seed: string;
      status: string;
      verified_at: string | Date | null;
      verification_method: string | null;
      created_at: string | Date;
      role_keys: string[] | null;
    }[];
    return ok(
      rows.map((r) => ({
        userId: r.user_id,
        handle: r.handle,
        avatarSeed: r.avatar_seed,
        roles: r.role_keys ?? [],
        status: r.status,
        verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
        verificationMethod: (r.verification_method as VerificationMethod | null) ?? null,
        createdAt: new Date(r.created_at),
      })),
    );
  });
}

export type StatusRefusal = 'not_allowed' | 'not_found' | 'self' | 'last_admin';

/**
 * Whether this person is the only active holder of `tenant_admin` here.
 * Suspending them would leave the tenant unable to administer itself.
 */
async function isLastActiveAdmin(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const holders = await tx
    .select({ userId: membershipRoles.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, membershipRoles.membershipId))
    .where(
      and(
        eq(membershipRoles.tenantId, tenantId),
        eq(roles.key, 'tenant_admin'),
        eq(tenantMemberships.status, 'active'),
      ),
    );
  return holders.length > 0 && holders.every((h) => h.userId === userId);
}

/**
 * Suspend a membership, or reinstate it.
 *
 * A suspended member keeps their account and their public profile but holds no
 * permissions here: the resolver answers only for active memberships, so the
 * change takes effect on their next request. Never oneself, and never the last
 * active administrator. Idempotent: setting the status it already has changes
 * nothing and says so.
 */
export async function setMemberStatus(
  actor: { userId: string },
  tenantId: string,
  memberUserId: string,
  status: MemberStatus,
): Promise<Result<{ changed: boolean }, StatusRefusal>> {
  if (memberUserId === actor.userId) return err('self');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'manage-members'))) {
      return err('not_allowed');
    }
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, memberUserId)),
      );
    if (!membership) return err('not_found');
    if (membership.status === status) return ok({ changed: false });
    if (status === 'suspended' && (await isLastActiveAdmin(tx, tenantId, memberUserId))) {
      return err('last_admin');
    }

    await tx
      .update(tenantMemberships)
      .set({ status })
      .where(eq(tenantMemberships.id, membership.id));
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId,
      action: status === 'suspended' ? 'member.suspended' : 'member.reinstated',
      targetType: 'membership',
      targetId: membership.id,
      meta: { targetUserId: memberUserId },
    });
    return ok({ changed: true });
  });
}
