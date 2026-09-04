import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import type { VerificationMethod } from './membership';
import { canInTransaction } from './rbac';

/**
 * The member list.
 *
 * Needs `manage-members`, re-checked inside the transaction that does the
 * work. Standing, the other thing done to a membership that is not a role,
 * lives in `standing.ts` behind its own permission. Handles only: nothing here
 * reads an email.
 */

export type ActivityBucket = 'day' | 'week' | 'month' | 'older' | 'never';

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
  /** How recently they were seen, as a bucket. Never a timestamp. */
  activity: ActivityBucket;
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
               coalesce(a.bucket, 'never') as activity,
               coalesce(
                 (select array_agg(r.key order by r.key)
                    from membership_roles mr
                    join roles r on r.id = mr.role_id
                   where mr.membership_id = m.id),
                 '{}'
               ) as role_keys
        from tenant_memberships m
        left join public_profiles p on p.user_id = m.user_id
        left join auth_tenant_member_activity(${tenantId}) a on a.user_id = m.user_id
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
      activity: string;
    }[];
    return ok(
      rows.map((r) => ({
        userId: r.user_id,
        handle: r.handle,
        avatarSeed: r.avatar_seed,
        roles: r.role_keys ?? [],
        activity: r.activity as ActivityBucket,
        status: r.status,
        verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
        verificationMethod: (r.verification_method as VerificationMethod | null) ?? null,
        createdAt: new Date(r.created_at),
      })),
    );
  });
}
