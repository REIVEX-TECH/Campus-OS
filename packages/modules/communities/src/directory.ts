import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';
import { communities, communityMemberships } from './schema/communities';
import { toCommunitySummary, type CommunitySummary } from './communities';

/**
 * The directory: which communities a tenant has, and where one person stands
 * in one of them. Reads only.
 */

export type DirectoryOrder = 'members' | 'new' | 'name';

/** Live, approved, public communities: biggest first (then by name), newest first, or by name. */
export async function listCommunities(
  tenantId: string,
  limit = 100,
  order: DirectoryOrder = 'members',
): Promise<CommunitySummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.approvalStatus, 'approved'),
          eq(communities.visibility, 'public'),
          isNull(communities.deletedAt),
        ),
      )
      .orderBy(
        ...(order === 'new'
          ? [desc(communities.createdAt), asc(communities.name)]
          : order === 'name'
            ? [asc(communities.name)]
            : [desc(communities.memberCount), asc(communities.name)]),
      )
      .limit(limit);
    return rows.map(toCommunitySummary);
  });
}

/** Communities waiting for a tenant administrator's approval. */
export async function listPendingCommunities(tenantId: string): Promise<CommunitySummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.approvalStatus, 'pending'),
          isNull(communities.deletedAt),
        ),
      )
      .orderBy(asc(communities.createdAt));
    return rows.map(toCommunitySummary);
  });
}

export interface MembershipState {
  joined: boolean;
  /** Keys of the community roles held, sorted. */
  roles: string[];
}

/** Where this person stands in one community: joined or not, and which roles. */
export async function membershipState(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<MembershipState> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [membership] = await tx
      .select({ id: communityMemberships.id })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, communityId),
          eq(communityMemberships.userId, actor.userId),
          isNull(communityMemberships.leftAt),
        ),
      );
    if (!membership) return { joined: false, roles: [] };
    const roles = [
      ...(await tx.execute(
        // Role keys come from the identity module's table, read by name.
        sql`
          select r.key from community_member_roles cmr
          join roles r on r.id = cmr.role_id
          where cmr.membership_id = ${membership.id}
          order by r.key`,
      )),
    ] as { key: string }[];
    return { joined: true, roles: roles.map((r) => r.key) };
  });
}
