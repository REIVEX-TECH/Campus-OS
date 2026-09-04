import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Who belongs to a community, with the roles they hold there. Public within
 * the tenant, like the community itself; handles only. Owners first, then
 * moderators, then everyone else by when they joined.
 */

export interface CommunityMember {
  userId: string;
  handle: string;
  avatarSeed: string;
  /** Community role keys held, sorted; empty for a plain member. */
  roles: string[];
  joinedAt: Date;
}

const RANK = sql`case
  when bool_or(r.key = 'community_owner') then 0
  when bool_or(r.key = 'community_moderator') then 1
  else 2 end`;

export async function listMembers(
  tenantId: string,
  communityId: string,
  limit = 200,
): Promise<CommunityMember[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select cm.user_id, p.handle, p.avatar_seed, cm.joined_at,
               coalesce(array_agg(r.key order by r.key) filter (where r.key is not null), '{}') as role_keys,
               ${RANK} as rank
        from community_memberships cm
        join public_profiles p on p.user_id = cm.user_id
        left join community_member_roles cmr on cmr.membership_id = cm.id
        left join roles r on r.id = cmr.role_id
        where cm.tenant_id = ${tenantId} and cm.community_id = ${communityId}::uuid
          and cm.left_at is null
        group by cm.user_id, p.handle, p.avatar_seed, cm.joined_at
        order by rank asc, cm.joined_at asc
        limit ${limit}`)),
    ] as {
      user_id: string;
      handle: string;
      avatar_seed: string;
      joined_at: string | Date;
      role_keys: string[] | null;
    }[];
    return rows.map((r) => ({
      userId: r.user_id,
      handle: r.handle,
      avatarSeed: r.avatar_seed,
      roles: (r.role_keys ?? []).filter((k) => k !== 'community_member'),
      joinedAt: new Date(r.joined_at),
    }));
  });
}

/** The moderators and owners, for the rail. */
export async function listModerators(
  tenantId: string,
  communityId: string,
): Promise<CommunityMember[]> {
  const members = await listMembers(tenantId, communityId, 50);
  return members.filter((m) => m.roles.length > 0);
}
