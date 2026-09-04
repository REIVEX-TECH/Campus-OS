import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { POST, toPostView, type PostView } from './posts';
import {
  communities,
  postVotes,
  postsRead,
  publicProfiles,
  savedItems,
} from './schema/communities';

/**
 * Lists of posts, paged by cursor. A3 lists a community newest first; A5 adds
 * the other sorts and the Home and All feeds on the same shape. Pages are
 * pages: the caller renders a "more" link carrying the cursor, never an
 * infinite scroll.
 */

export interface PostPage {
  items: PostView[];
  /** Opaque; pass back as `cursor` for the next page. Null at the end. */
  nextCursor: string | null;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso ?? '');
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export const PAGE_SIZE = 25;

async function page(
  tx: TenantTransaction,
  viewer: { userId: string } | null,
  where: ReturnType<typeof and>,
  cursor: string | undefined,
  limit: number,
): Promise<PostPage> {
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await tx
    .select({
      post: POST,
      handle: publicProfiles.handle,
      avatarSeed: publicProfiles.avatarSeed,
      myVote: postVotes.value,
      saved: savedItems.itemId,
      communitySlug: communities.slug,
      communityName: communities.name,
    })
    .from(postsRead)
    .leftJoin(communities, eq(communities.id, postsRead.communityId))
    .leftJoin(publicProfiles, eq(publicProfiles.userId, postsRead.publicAuthorId))
    // Own-row tables: these joins yield the viewer's rows and nobody else's.
    .leftJoin(postVotes, eq(postVotes.postId, postsRead.id))
    .leftJoin(savedItems, and(eq(savedItems.itemType, 'post'), eq(savedItems.itemId, postsRead.id)))
    .where(
      and(
        where,
        isNull(postsRead.deletedAt),
        isNull(postsRead.removedAt),
        after
          ? or(
              lt(postsRead.createdAt, after.createdAt),
              and(eq(postsRead.createdAt, after.createdAt), lt(postsRead.id, after.id)),
            )
          : undefined,
        viewer
          ? sql`not exists (select 1 from hidden_items h where h.item_type = 'post' and h.item_id = ${postsRead.id} and h.user_id = ${viewer.userId}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(postsRead.createdAt), desc(postsRead.id))
    .limit(limit + 1);
  const items = rows
    .slice(0, limit)
    .map((r) =>
      toPostView(
        r.post,
        r.handle,
        r.avatarSeed,
        { myVote: r.myVote, saved: r.saved !== null },
        { slug: r.communitySlug, name: r.communityName },
      ),
    );
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** A community's posts, newest first, a page at a time. */
export async function listCommunityPosts(
  viewer: { userId: string } | null,
  tenantId: string,
  communityId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<PostPage> {
  const limit = Math.min(Math.max(1, options.limit ?? PAGE_SIZE), 100);
  const where = and(eq(postsRead.tenantId, tenantId), eq(postsRead.communityId, communityId));
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) =>
        page(tx, viewer, where, options.cursor, limit),
      )
    : withTenant(tenantId, (tx) => page(tx, null, where, options.cursor, limit));
}
