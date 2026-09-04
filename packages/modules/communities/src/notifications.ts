import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { decodeCursor, encodeCursor } from './feed';
import { communities, notifications, postsRead, publicProfiles } from './schema/communities';

/**
 * In-app notifications: a comment on your post, a reply to your comment, a
 * moderator's removal. Written by a database function that looks the
 * recipient up itself (the app never reads an author), read by the recipient
 * alone under RLS. The actor is recorded only when they acted under their
 * handle; an anonymous comment notifies as "someone".
 */

export type NotificationKind = 'comment_on_post' | 'reply' | 'post_removed' | 'comment_removed';

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  actor: { handle: string; avatarSeed: string } | null;
  communitySlug: string;
  communityName: string;
  postId: string | null;
  postTitle: string | null;
  commentId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationView[];
  nextCursor: string | null;
}

/** Inside a write transaction: tell the author of the post or the parent comment. */
export async function notify(
  tx: TenantTransaction,
  kind: NotificationKind,
  about: { postId: string; commentId: string | null; actorId: string; actorPublic: boolean },
): Promise<void> {
  await tx.execute(
    sql`select communities_notify(${kind}, ${about.postId}::uuid, ${about.commentId}::uuid, ${about.actorId}::uuid, ${about.actorPublic})`,
  );
}

/** The viewer's inbox, newest first, a page at a time. */
export async function listNotifications(
  actor: { userId: string },
  tenantId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(1, options.limit ?? 30), 100);
  const after = options.cursor ? decodeCursor(options.cursor, 2) : null;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
        communitySlug: communities.slug,
        communityName: communities.name,
        postId: notifications.postId,
        postTitle: postsRead.title,
        commentId: notifications.commentId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .innerJoin(communities, eq(communities.id, notifications.communityId))
      .leftJoin(postsRead, eq(postsRead.id, notifications.postId))
      .leftJoin(publicProfiles, eq(publicProfiles.userId, notifications.actorId))
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, actor.userId),
          after
            ? or(
                lt(notifications.createdAt, new Date(after[0]!)),
                and(
                  eq(notifications.createdAt, new Date(after[0]!)),
                  lt(notifications.id, after[1]!),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    return {
      items: shown.map((r) => ({
        id: r.id,
        kind: r.kind as NotificationKind,
        actor: r.handle && r.avatarSeed ? { handle: r.handle, avatarSeed: r.avatarSeed } : null,
        communitySlug: r.communitySlug,
        communityName: r.communityName,
        postId: r.postId,
        postTitle: r.postTitle,
        commentId: r.commentId,
        readAt: r.readAt,
        createdAt: r.createdAt,
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    };
  });
}

/** How many are unread, for the bell. */
export async function unreadCount(actor: { userId: string }, tenantId: string): Promise<number> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, actor.userId),
          isNull(notifications.readAt),
        ),
      );
    return row?.n ?? 0;
  });
}

/** Mark some, or all, as read. Own rows only, by RLS. */
export async function markRead(
  actor: { userId: string },
  tenantId: string,
  ids: string[] | 'all',
): Promise<{ marked: number }> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const updated = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, actor.userId),
          isNull(notifications.readAt),
          ids === 'all' ? undefined : inArray(notifications.id, ids),
        ),
      )
      .returning({ id: notifications.id });
    return { marked: updated.length };
  });
}
