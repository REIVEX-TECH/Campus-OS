import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInCommunity, canInTenant, type Refusal } from './access';
import type { CommunitiesSettings } from './manifest';
import { notify } from './notifications';
import {
  comments,
  commentsRead,
  communityBans,
  communityMutes,
  moderationActions,
  posts,
  postsRead,
  publicProfiles,
  reports,
} from './schema/communities';

/**
 * What a moderator does to content and to members: remove and restore, lock,
 * pin, mute, and lift a ban or a mute. Every action is one transaction that
 * writes the change, resolves the reports it answers, and appends to the
 * community's mod log. Permission is `communities.moderate` in the community
 * or `communities.oversee` in the tenant, checked inside the transaction.
 * Nothing here reads an author column; removal never reveals who wrote what.
 */

export type ItemType = 'post' | 'comment';

export async function moderates(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
  communityId: string,
): Promise<boolean> {
  return (
    (await canInCommunity(tx, userId, tenantId, communityId, 'communities.moderate')) ||
    (await canInTenant(tx, userId, tenantId, 'communities.oversee'))
  );
}

export async function logAction(
  tx: TenantTransaction,
  entry: {
    tenantId: string;
    communityId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(moderationActions).values({
    tenantId: entry.tenantId,
    communityId: entry.communityId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason ?? null,
    meta: entry.meta ?? null,
  });
}

interface Located {
  communityId: string;
  postId: string;
  removedAt: Date | null;
  pinnedAt: Date | null;
  lockedAt: Date | null;
}

/** Where an item lives, through the read views. Null for unknown or author deleted. */
async function locate(tx: TenantTransaction, type: ItemType, id: string): Promise<Located | null> {
  if (type === 'post') {
    const [p] = await tx
      .select({
        communityId: postsRead.communityId,
        removedAt: postsRead.removedAt,
        deletedAt: postsRead.deletedAt,
        pinnedAt: postsRead.pinnedAt,
        lockedAt: postsRead.lockedAt,
      })
      .from(postsRead)
      .where(eq(postsRead.id, id));
    return p && !p.deletedAt ? { ...p, postId: id } : null;
  }
  const [c] = await tx
    .select({
      communityId: postsRead.communityId,
      postId: commentsRead.postId,
      removedAt: commentsRead.removedAt,
      deletedAt: commentsRead.deletedAt,
    })
    .from(commentsRead)
    .innerJoin(postsRead, eq(postsRead.id, commentsRead.postId))
    .where(eq(commentsRead.id, id));
  return c && !c.deletedAt ? { ...c, pinnedAt: null, lockedAt: null } : null;
}

async function resolveReports(
  tx: TenantTransaction,
  type: ItemType,
  id: string,
  actorId: string,
  resolution: 'approved' | 'removed',
): Promise<void> {
  await tx
    .update(reports)
    .set({ status: 'resolved', resolution, resolvedBy: actorId, resolvedAt: new Date() })
    .where(and(eq(reports.itemType, type), eq(reports.itemId, id), eq(reports.status, 'open')));
}

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Take an item down with a reason. Resolves its open reports as removed. Idempotent. */
export async function removeItem(
  actor: { userId: string },
  tenantId: string,
  type: ItemType,
  id: string,
  input: z.input<typeof reasonSchema>,
): Promise<Result<{ removed: true }, Refusal>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const reason = parsed.data.reason;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const item = await locate(tx, type, id);
    if (!item) return err('not_found');
    if (!(await moderates(tx, actor.userId, tenantId, item.communityId))) return err('not_allowed');
    if (!item.removedAt) {
      const change = { removedAt: new Date(), removalReason: reason };
      if (type === 'post') await tx.update(posts).set(change).where(eq(posts.id, id));
      else await tx.update(comments).set(change).where(eq(comments.id, id));
    }
    await resolveReports(tx, type, id, actor.userId, 'removed');
    await logAction(tx, {
      tenantId,
      communityId: item.communityId,
      actorId: actor.userId,
      action: type === 'post' ? 'remove_post' : 'remove_comment',
      targetType: type,
      targetId: id,
      reason,
      meta: { postId: item.postId },
    });
    // The author learns it happened, not who did it.
    await notify(tx, type === 'post' ? 'post_removed' : 'comment_removed', {
      postId: item.postId,
      commentId: type === 'comment' ? id : null,
      actorId: actor.userId,
      actorPublic: false,
    });
    return ok({ removed: true });
  });
}

/** Keep an item: restore it if it was removed, and resolve its open reports as approved. */
export async function approveItem(
  actor: { userId: string },
  tenantId: string,
  type: ItemType,
  id: string,
): Promise<Result<{ approved: true }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const item = await locate(tx, type, id);
    if (!item) return err('not_found');
    if (!(await moderates(tx, actor.userId, tenantId, item.communityId))) return err('not_allowed');
    if (item.removedAt) {
      const change = { removedAt: null, removalReason: null };
      if (type === 'post') await tx.update(posts).set(change).where(eq(posts.id, id));
      else await tx.update(comments).set(change).where(eq(comments.id, id));
    }
    await resolveReports(tx, type, id, actor.userId, 'approved');
    await logAction(tx, {
      tenantId,
      communityId: item.communityId,
      actorId: actor.userId,
      action: type === 'post' ? 'approve_post' : 'approve_comment',
      targetType: type,
      targetId: id,
      meta: { postId: item.postId, restored: item.removedAt !== null },
    });
    return ok({ approved: true });
  });
}

/** Lock or unlock a post: no new comments while locked. */
export async function setLocked(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  locked: boolean,
): Promise<Result<{ locked: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const item = await locate(tx, 'post', postId);
    if (!item) return err('not_found');
    if (!(await moderates(tx, actor.userId, tenantId, item.communityId))) return err('not_allowed');
    if (locked !== (item.lockedAt !== null)) {
      await tx
        .update(posts)
        .set({ lockedAt: locked ? new Date() : null })
        .where(eq(posts.id, postId));
      await logAction(tx, {
        tenantId,
        communityId: item.communityId,
        actorId: actor.userId,
        action: locked ? 'lock' : 'unlock',
        targetType: 'post',
        targetId: postId,
      });
    }
    return ok({ locked });
  });
}

/** Pin or unpin a post at the top of its community, within the tenant's cap. */
export async function setPinned(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  pinned: boolean,
  settings: CommunitiesSettings,
): Promise<Result<{ pinned: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const item = await locate(tx, 'post', postId);
    if (!item) return err('not_found');
    if (!(await moderates(tx, actor.userId, tenantId, item.communityId))) return err('not_allowed');
    if (pinned === (item.pinnedAt !== null)) return ok({ pinned });
    if (pinned) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(postsRead)
        .where(
          and(
            eq(postsRead.communityId, item.communityId),
            sql`${postsRead.pinnedAt} is not null`,
            isNull(postsRead.deletedAt),
            isNull(postsRead.removedAt),
          ),
        );
      if ((row?.n ?? 0) >= settings.pinnedPerCommunity) return err('pin_cap');
    }
    await tx
      .update(posts)
      .set({ pinnedAt: pinned ? new Date() : null })
      .where(eq(posts.id, postId));
    await logAction(tx, {
      tenantId,
      communityId: item.communityId,
      actorId: actor.userId,
      action: pinned ? 'pin' : 'unpin',
      targetType: 'post',
      targetId: postId,
    });
    return ok({ pinned });
  });
}

export const sanctionInputSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  /** Minutes from now; omit for permanent. */
  minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .optional(),
});

/** Mute a member of a community: they stay, they cannot post or comment there. Never oneself. */
export async function muteMember(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  userId: string,
  input: z.input<typeof sanctionInputSchema>,
): Promise<Result<{ id: string }, Refusal>> {
  const parsed = sanctionInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  if (userId === actor.userId) return err('self');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await moderates(tx, actor.userId, tenantId, communityId))) return err('not_allowed');
    const until = parsed.data.minutes ? new Date(Date.now() + parsed.data.minutes * 60_000) : null;
    const [mute] = await tx
      .insert(communityMutes)
      .values({
        tenantId,
        communityId,
        userId,
        reason: parsed.data.reason,
        until,
        createdBy: actor.userId,
      })
      .returning({ id: communityMutes.id });
    await logAction(tx, {
      tenantId,
      communityId,
      actorId: actor.userId,
      action: 'mute',
      targetType: 'user',
      targetId: userId,
      reason: parsed.data.reason,
      meta: { until: until?.toISOString() ?? null },
    });
    return ok({ id: mute!.id });
  });
}

/** Lift a ban or a mute early. A tenant wide ban needs `communities.oversee` and goes to the audit log. */
export async function liftSanction(
  actor: { userId: string },
  tenantId: string,
  kind: 'ban' | 'mute',
  id: string,
): Promise<Result<{ lifted: true }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const table = kind === 'ban' ? communityBans : communityMutes;
    const [row] = await tx
      .select({ communityId: table.communityId, userId: table.userId })
      .from(table)
      .where(and(eq(table.id, id), isNull(table.liftedAt)));
    if (!row) return err('not_found');
    const allowed = row.communityId
      ? await moderates(tx, actor.userId, tenantId, row.communityId)
      : await canInTenant(tx, actor.userId, tenantId, 'communities.oversee');
    if (!allowed) return err('not_allowed');
    await tx.update(table).set({ liftedAt: new Date() }).where(eq(table.id, id));
    if (row.communityId) {
      await logAction(tx, {
        tenantId,
        communityId: row.communityId,
        actorId: actor.userId,
        action: kind === 'ban' ? 'unban' : 'unmute',
        targetType: 'user',
        targetId: row.userId,
      });
    } else {
      await tx.execute(sql`
        insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
        values (${actor.userId}::uuid, ${tenantId}, 'communities.tenant_unbanned', 'user', ${row.userId}, '{}'::jsonb)`);
    }
    return ok({ lifted: true });
  });
}

export interface Sanction {
  id: string;
  kind: 'ban' | 'mute';
  userId: string;
  handle: string;
  avatarSeed: string;
  reason: string;
  until: Date | null;
  createdAt: Date;
}

/** The active bans and mutes in a community, for its moderators. */
export async function listSanctions(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<Result<Sanction[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await moderates(tx, actor.userId, tenantId, communityId))) return err('not_allowed');
    const bans = await tx
      .select({
        id: communityBans.id,
        userId: communityBans.userId,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
        reason: communityBans.reason,
        until: communityBans.until,
        createdAt: communityBans.createdAt,
      })
      .from(communityBans)
      .leftJoin(publicProfiles, eq(publicProfiles.userId, communityBans.userId))
      .where(
        and(
          eq(communityBans.communityId, communityId),
          isNull(communityBans.liftedAt),
          or(isNull(communityBans.until), sql`${communityBans.until} > now()`),
        ),
      )
      .orderBy(desc(communityBans.createdAt));
    const mutes = await tx
      .select({
        id: communityMutes.id,
        userId: communityMutes.userId,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
        reason: communityMutes.reason,
        until: communityMutes.until,
        createdAt: communityMutes.createdAt,
      })
      .from(communityMutes)
      .leftJoin(publicProfiles, eq(publicProfiles.userId, communityMutes.userId))
      .where(
        and(
          eq(communityMutes.communityId, communityId),
          isNull(communityMutes.liftedAt),
          or(isNull(communityMutes.until), sql`${communityMutes.until} > now()`),
        ),
      )
      .orderBy(desc(communityMutes.createdAt));
    const shape = (kind: 'ban' | 'mute') => (r: (typeof bans)[number]) => ({
      id: r.id,
      kind,
      userId: r.userId,
      handle: r.handle ?? '',
      avatarSeed: r.avatarSeed ?? '',
      reason: r.reason,
      until: r.until,
      createdAt: r.createdAt,
    });
    return ok([...bans.map(shape('ban')), ...mutes.map(shape('mute'))]);
  });
}
