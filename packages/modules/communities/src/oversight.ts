import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTenant, type Refusal } from './access';
import { communities, publicProfiles } from './schema/communities';

/**
 * The tenant's view over every community, for `communities.oversee`: the
 * list with its standing and open report counts, and dissolution. Dissolving
 * is a soft delete that lands in the tenant audit log; the rows stay for the
 * record and every read path already excludes a deleted community.
 */

export interface OversightCommunity {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  approvalStatus: string;
  memberCount: number;
  createdAt: Date;
  archivedAt: Date | null;
  openReports: number;
}

export async function listCommunitiesForOversight(
  actor: { userId: string },
  tenantId: string,
): Promise<Result<OversightCommunity[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTenant(tx, actor.userId, tenantId, 'communities.oversee'))) {
      return err('not_allowed');
    }
    const rows = await tx
      .select({
        id: communities.id,
        slug: communities.slug,
        name: communities.name,
        visibility: communities.visibility,
        approvalStatus: communities.approvalStatus,
        memberCount: communities.memberCount,
        createdAt: communities.createdAt,
        archivedAt: communities.archivedAt,
        // Named in full: inside a single table select the column would render bare and bind to r.id.
        openReports: sql<number>`(select count(*)::int from reports r
          where r.community_id = communities.id and r.status = 'open')`,
      })
      .from(communities)
      .where(and(eq(communities.tenantId, tenantId), isNull(communities.deletedAt)))
      .orderBy(sql`${communities.approvalStatus} = 'pending' desc`, communities.name);
    return ok(rows);
  });
}

export const dissolveInputSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Close a community for good. Its content stays in the database, unreachable. Audited. */
export async function dissolveCommunity(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: z.input<typeof dissolveInputSchema>,
): Promise<Result<{ dissolved: boolean }, Refusal>> {
  const parsed = dissolveInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTenant(tx, actor.userId, tenantId, 'communities.oversee'))) {
      return err('not_allowed');
    }
    const updated = await tx
      .update(communities)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(communities.id, communityId),
          eq(communities.tenantId, tenantId),
          isNull(communities.deletedAt),
        ),
      )
      .returning({ slug: communities.slug });
    const slug = updated[0]?.slug;
    if (!slug) return ok({ dissolved: false });
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, ${tenantId}, 'communities.dissolved', 'community', ${communityId},
              jsonb_build_object('slug', ${slug}::text, 'reason', ${parsed.data.reason}::text))`);
    return ok({ dissolved: true });
  });
}

/** The public handle behind a user id, for showing the result of an audited unmask. */
export async function handleOf(
  actor: { userId: string },
  tenantId: string,
  userId: string,
): Promise<string | null> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = await tx
      .select({ handle: publicProfiles.handle })
      .from(publicProfiles)
      .where(eq(publicProfiles.userId, userId));
    return row?.handle ?? null;
  });
}
