import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import {
  comments,
  commentsRead,
  communities,
  postsRead,
  publicProfiles,
  userBlocks,
} from './schema/communities';

/**
 * Public profiles: a handle, an avatar, what a person wrote under that handle,
 * and a modest karma when the tenant shows it. Everything here is keyed on the
 * public author column, which is null for anonymous items, so nothing a person
 * posted anonymously can reach their profile whatever the caller passes.
 */

export interface Profile {
  userId: string;
  handle: string;
  avatarSeed: string;
}

export interface Karma {
  posts: number;
  comments: number;
  total: number;
}

export interface AuthoredComment {
  id: string;
  body: string;
  score: number;
  createdAt: Date;
  removedAt: Date | null;
  postId: string;
  postTitle: string;
  communitySlug: string;
  communityName: string;
}

/** The profile behind a handle, matched without regard to case. Null when there is none. */
export async function profileByHandle(tenantId: string, handle: string): Promise<Profile | null> {
  const wanted = handle.trim().toLowerCase();
  if (!wanted) return null;
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(publicProfiles)
      .where(sql`lower(${publicProfiles.handle}) = ${wanted}`)
      .limit(1);
    return row ? { userId: row.userId, handle: row.handle, avatarSeed: row.avatarSeed } : null;
  });
}

/** Score summed over what a person wrote under their handle, live items only. */
export async function karmaOf(tenantId: string, userId: string): Promise<Karma> {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .select({ n: sql<number>`coalesce(sum(${postsRead.score}), 0)::int` })
      .from(postsRead)
      .where(
        and(
          eq(postsRead.tenantId, tenantId),
          eq(postsRead.publicAuthorId, userId),
          isNull(postsRead.deletedAt),
          isNull(postsRead.removedAt),
        ),
      );
    const [c] = await tx
      .select({ n: sql<number>`coalesce(sum(${commentsRead.score}), 0)::int` })
      .from(commentsRead)
      .where(
        and(
          eq(commentsRead.tenantId, tenantId),
          eq(commentsRead.publicAuthorId, userId),
          isNull(commentsRead.deletedAt),
          isNull(commentsRead.removedAt),
        ),
      );
    const posts = p?.n ?? 0;
    const cm = c?.n ?? 0;
    return { posts, comments: cm, total: posts + cm };
  });
}

async function readComments(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
  limit: number,
): Promise<AuthoredComment[]> {
  const rows = await tx
    .select({
      id: commentsRead.id,
      body: commentsRead.body,
      score: commentsRead.score,
      createdAt: commentsRead.createdAt,
      removedAt: commentsRead.removedAt,
      postId: postsRead.id,
      postTitle: postsRead.title,
      communitySlug: communities.slug,
      communityName: communities.name,
    })
    .from(commentsRead)
    .innerJoin(postsRead, eq(postsRead.id, commentsRead.postId))
    .innerJoin(communities, eq(communities.id, postsRead.communityId))
    .where(
      and(
        eq(commentsRead.tenantId, tenantId),
        eq(commentsRead.publicAuthorId, userId),
        isNull(commentsRead.deletedAt),
        isNull(postsRead.deletedAt),
        isNull(postsRead.removedAt),
        eq(communities.visibility, 'public'),
        isNull(communities.deletedAt),
      ),
    )
    .orderBy(desc(commentsRead.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    // A removed comment keeps its place in the count of a life, not its words.
    body: r.removedAt ? '' : r.body,
  }));
}

/** What a person said under their handle, newest first, in public communities. */
export async function commentsByAuthor(
  tenantId: string,
  userId: string,
  limit = 30,
): Promise<AuthoredComment[]> {
  return withTenant(tenantId, (tx) => readComments(tx, tenantId, userId, limit));
}

/** Whether the viewer has blocked this person. Own rows, by RLS. */
export async function isBlocked(
  actor: { userId: string },
  tenantId: string,
  userId: string,
): Promise<boolean> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({ blocked: userBlocks.blockedId })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, actor.userId), eq(userBlocks.blockedId, userId)));
    return rows.length > 0;
  });
}

// Referenced for the profile index; the comments table itself is never read here.
void comments;
