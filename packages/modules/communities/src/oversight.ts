import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTenant, type Refusal } from './access';
import { communities, publicProfiles, reports } from './schema/communities';

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

export interface ReportedPerson {
  userId: string;
  handle: string;
  avatarSeed: string;
  /** Open reports about them, across the whole tenant. */
  openReports: number;
  /** At or over the tenant's threshold: repeated reports raise this, nothing else does. */
  flagged: boolean;
  reasons: string[];
  lastReportedAt: Date;
}

/**
 * Who has been reported as a person, most reported first.
 *
 * Tenant wide, because a report about somebody belongs to the university and
 * not to whichever community they were last seen in. Behind `restrict-members`,
 * the permission for the thing this queue leads to: reading who has been
 * complained about is already knowing something about them, so it belongs with
 * the power to act rather than with the power to moderate one community.
 *
 * Nothing here is applied automatically. `flagged` says repeated people have
 * reported this person, and a human decides what, if anything, follows.
 */
export async function listReportedPeople(
  actor: { userId: string },
  tenantId: string,
  threshold = 3,
): Promise<Result<ReportedPerson[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTenant(tx, actor.userId, tenantId, 'restrict-members'))) {
      return err('not_allowed');
    }
    const rows = [
      ...(await tx.execute(sql`
        select r.item_id as user_id, p.handle,
               coalesce(p.avatar_seed, r.item_id::text) as avatar_seed,
               count(*)::int as open_reports,
               array_agg(distinct r.reason) as reasons,
               max(r.created_at) as last_reported_at
        from reports r
        left join public_profiles p on p.user_id = r.item_id
        where r.tenant_id = ${tenantId} and r.item_type = 'user' and r.status = 'open'
        group by r.item_id, p.handle, p.avatar_seed
        order by count(*) desc, max(r.created_at) desc`)),
    ] as {
      user_id: string;
      handle: string | null;
      avatar_seed: string;
      open_reports: number;
      reasons: string[];
      last_reported_at: string | Date;
    }[];
    return ok(
      rows.map((r) => ({
        userId: r.user_id,
        handle: r.handle ?? '',
        avatarSeed: r.avatar_seed,
        openReports: r.open_reports,
        flagged: r.open_reports >= threshold,
        reasons: r.reasons,
        // Raw rows carry their timestamps as text.
        lastReportedAt:
          r.last_reported_at instanceof Date ? r.last_reported_at : new Date(r.last_reported_at),
      })),
    );
  });
}

/**
 * Close every open report about a person, with what was decided.
 *
 * The decision itself is elsewhere: restricting or suspending them is a
 * separate, signed act. This only says the queue has been dealt with, so the
 * next administrator is not looking at the same complaint again.
 */
export async function resolveUserReports(
  actor: { userId: string },
  tenantId: string,
  userId: string,
  resolution: 'dismissed' | 'acted',
): Promise<Result<{ closed: number }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTenant(tx, actor.userId, tenantId, 'restrict-members'))) {
      return err('not_allowed');
    }
    const closed = await tx
      .update(reports)
      .set({
        status: 'resolved',
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        resolution,
      })
      .where(
        and(
          eq(reports.tenantId, tenantId),
          eq(reports.itemType, 'user'),
          eq(reports.itemId, userId),
          eq(reports.status, 'open'),
        ),
      )
      .returning({ id: reports.id });
    if (closed.length === 0) return err('not_found');
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, ${tenantId}, 'reports.person_resolved', 'user', ${userId},
              jsonb_build_object('resolution', ${resolution}::text, 'closed', ${closed.length}::int))`);
    return ok({ closed: closed.length });
  });
}
