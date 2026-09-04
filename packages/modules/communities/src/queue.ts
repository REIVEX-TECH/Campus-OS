import { eq, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTenant, type Refusal } from './access';
import { decodeCursor, encodeCursor } from './feed';
import { moderates } from './mod-actions';
import { HELD_BY_FILTER, HIDDEN_BY_REPORTS, REMOVED_BY_FILTER, SYSTEM_ACTOR } from './automod';
import { communities } from './schema/communities';

/**
 * The mod queue and the mod log. The queue is open reports grouped by the
 * item they name, newest report first, for one community's moderators or,
 * tenant wide, for `communities.oversee`. The log is what moderators did,
 * public when the community says so; a public log names the moderator and
 * the item but never the member a ban or mute was about. Raw rows carry
 * their timestamps as text, so the Dates are made here.
 */

export interface QueueItem {
  itemType: 'post' | 'comment';
  itemId: string;
  /** The post the item is, or belongs to. */
  postId: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  title: string;
  excerpt: string;
  isAnonymous: boolean;
  removedAt: Date | null;
  reportCount: number;
  reasons: string[];
  reportIds: string[];
  firstReportedAt: Date;
  lastReportedAt: Date;
}

interface QueueRow {
  item_type: 'post' | 'comment';
  item_id: string;
  community_id: string;
  community_slug: string;
  community_name: string;
  post_id: string;
  title: string | null;
  excerpt: string | null;
  is_anonymous: boolean | null;
  removed_at: string | null;
  report_count: number;
  reasons: string[];
  report_ids: string[];
  first_reported_at: string;
  last_reported_at: string;
}

export async function listQueue(
  actor: { userId: string },
  tenantId: string,
  communityId: string | null,
  limit = 50,
): Promise<Result<QueueItem[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const allowed = communityId
      ? await moderates(tx, actor.userId, tenantId, communityId)
      : await canInTenant(tx, actor.userId, tenantId, 'communities.oversee');
    if (!allowed) return err('not_allowed');
    const rows = [
      ...(await tx.execute(sql`
        with grouped as (
          select r.item_type, r.item_id, r.community_id,
                 count(*)::int as report_count,
                 array_agg(distinct r.reason) as reasons,
                 array_agg(r.id::text order by r.created_at) as report_ids,
                 min(r.created_at) as first_reported_at,
                 max(r.created_at) as last_reported_at
          from reports r
          where r.tenant_id = ${tenantId} and r.status = 'open'
            ${communityId ? sql`and r.community_id = ${communityId}::uuid` : sql``}
          group by r.item_type, r.item_id, r.community_id)
        select g.*, c.slug as community_slug, c.name as community_name,
               coalesce(p.id, cm.post_id) as post_id,
               coalesce(p.title, pc.title) as title,
               left(coalesce(p.body, cm.body, ''), 280) as excerpt,
               coalesce(p.is_anonymous, cm.is_anonymous) as is_anonymous,
               coalesce(p.removed_at, cm.removed_at) as removed_at
        from grouped g
        join communities c on c.id = g.community_id
        left join posts_read p on g.item_type = 'post' and p.id = g.item_id
        left join comments_read cm on g.item_type = 'comment' and cm.id = g.item_id
        left join posts_read pc on pc.id = cm.post_id
        order by g.last_reported_at desc
        limit ${limit}`)),
    ] as unknown as QueueRow[];
    return ok(
      rows.map((r) => ({
        itemType: r.item_type,
        itemId: r.item_id,
        postId: r.post_id,
        communityId: r.community_id,
        communitySlug: r.community_slug,
        communityName: r.community_name,
        title: r.title ?? '',
        excerpt: r.excerpt ?? '',
        isAnonymous: r.is_anonymous ?? false,
        removedAt: r.removed_at ? new Date(r.removed_at) : null,
        reportCount: r.report_count,
        reasons: r.reasons,
        reportIds: r.report_ids,
        firstReportedAt: new Date(r.first_reported_at),
        lastReportedAt: new Date(r.last_reported_at),
      })),
    );
  });
}

export interface ModLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
  actorHandle: string | null;
  /** Written by automod or the report threshold, not by a person. */
  system: boolean;
  /** Only for moderators, and only when the target is a person. */
  targetHandle: string | null;
}

export interface ModLogPage {
  items: ModLogEntry[];
  nextCursor: string | null;
}

interface LogRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_id: string;
  actor_handle: string | null;
  target_handle: string | null;
}

async function readLog(
  tx: TenantTransaction,
  communityId: string,
  isModerator: boolean,
  options: { limit: number; cursor?: string },
): Promise<ModLogPage> {
  const after = options.cursor ? decodeCursor(options.cursor, 2) : null;
  const rows = [
    ...(await tx.execute(sql`
      select m.id, m.action, m.target_type, m.target_id, m.reason, m.meta, m.created_at,
             m.actor_id, a.handle as actor_handle,
             case when m.target_type = 'user' then u.handle end as target_handle
      from moderation_actions m
      left join public_profiles a on a.user_id = m.actor_id
      left join public_profiles u on m.target_type = 'user' and u.user_id = m.target_id::uuid
      where m.community_id = ${communityId}::uuid
        ${after ? sql`and (m.created_at, m.id) < (${new Date(after[0]!)}, ${after[1]}::uuid)` : sql``}
      order by m.created_at desc, m.id desc
      limit ${options.limit + 1}`)),
  ] as unknown as LogRow[];
  const shown = rows.slice(0, options.limit);
  const last = shown[shown.length - 1];
  return {
    items: shown.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.target_type,
      // A public log never names the member a sanction was about.
      targetId: !isModerator && r.target_type === 'user' ? '' : r.target_id,
      reason: r.reason,
      meta: r.meta,
      createdAt: new Date(r.created_at),
      actorHandle: r.actor_handle,
      system: r.actor_id === SYSTEM_ACTOR,
      targetHandle: isModerator ? r.target_handle : null,
    })),
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor([new Date(last.created_at).toISOString(), last.id])
        : null,
  };
}

/** The mod log: moderators always; everyone else when the community made it public. */
export async function listModLog(
  viewer: { userId: string } | null,
  tenantId: string,
  communityId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<Result<ModLogPage, Refusal>> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
  const read = async (tx: TenantTransaction, isModerator: boolean) => {
    const [c] = await tx
      .select({ modLogPublic: communities.modLogPublic, deletedAt: communities.deletedAt })
      .from(communities)
      .where(eq(communities.id, communityId));
    if (!c || c.deletedAt) return err('not_found' as const);
    if (!isModerator && !c.modLogPublic) return err('not_allowed' as const);
    return ok(await readLog(tx, communityId, isModerator, { limit, cursor: options.cursor }));
  };
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, async (tx) =>
        read(tx, await moderates(tx, viewer.userId, tenantId, communityId)),
      )
    : withTenant(tenantId, (tx) => read(tx, false));
}

export interface HeldItem {
  itemType: 'post' | 'comment';
  itemId: string;
  postId: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  title: string;
  excerpt: string;
  isAnonymous: boolean;
  /** Why it is held: a filter's hold, a filter's removal, or the report threshold. */
  reason: 'filter_hold' | 'filter_remove' | 'reports';
  heldAt: Date;
}

interface HeldRow {
  item_type: 'post' | 'comment';
  item_id: string;
  post_id: string;
  community_id: string;
  community_slug: string;
  community_name: string;
  title: string | null;
  excerpt: string | null;
  is_anonymous: boolean | null;
  removal_reason: string;
  removed_at: string;
}

const HELD_REASONS: Record<string, HeldItem['reason']> = {
  [HELD_BY_FILTER]: 'filter_hold',
  [REMOVED_BY_FILTER]: 'filter_remove',
  [HIDDEN_BY_REPORTS]: 'reports',
};

/** What automod and the report threshold took down in a community, newest first, for its moderators. */
export async function listHeld(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  limit = 50,
): Promise<Result<HeldItem[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await moderates(tx, actor.userId, tenantId, communityId))) return err('not_allowed');
    const codes = Object.keys(HELD_REASONS);
    const rows = [
      ...(await tx.execute(sql`
        select * from (
          select 'post' as item_type, p.id as item_id, p.id as post_id, p.community_id,
                 p.title, left(coalesce(p.body, ''), 280) as excerpt, p.is_anonymous,
                 p.removal_reason, p.removed_at
          from posts_read p
          where p.community_id = ${communityId}::uuid and p.deleted_at is null
            and p.removal_reason in ${codes}
          union all
          select 'comment', cm.id, cm.post_id, pc.community_id,
                 pc.title, left(cm.body, 280), cm.is_anonymous, cm.removal_reason, cm.removed_at
          from comments_read cm
          join posts_read pc on pc.id = cm.post_id
          where pc.community_id = ${communityId}::uuid and cm.deleted_at is null
            and cm.removal_reason in ${codes}
        ) h
        join communities c on c.id = h.community_id
        order by h.removed_at desc
        limit ${limit}`)),
    ] as unknown as HeldRow[];
    return ok(
      rows.map((r) => ({
        itemType: r.item_type,
        itemId: r.item_id,
        postId: r.post_id,
        communityId: r.community_id,
        communitySlug: r.community_slug,
        communityName: r.community_name,
        title: r.title ?? '',
        excerpt: r.excerpt ?? '',
        isAnonymous: r.is_anonymous ?? false,
        reason: HELD_REASONS[r.removal_reason] ?? 'filter_hold',
        heldAt: new Date(r.removed_at),
      })),
    );
  });
}
