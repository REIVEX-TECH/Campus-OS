import { randomUUID } from 'node:crypto';
import { and, asc, eq, getViewSelectedFields, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import {
  canInCommunity,
  isBanned,
  isVerifiedMember,
  LIMITS,
  ownCommentsLastHour,
  type Refusal,
} from './access';
import { canReplyAt, childPath } from './domain/paths';
import type { CommunitiesSettings } from './manifest';
import {
  commentEdits,
  comments,
  commentsRead,
  commentVotes,
  communities,
  posts,
  postsRead,
  publicProfiles,
  savedItems,
} from './schema/communities';

/**
 * Comments: a tree under a post, stored as materialised paths so one indexed
 * read returns a subtree in order. Written to `comments`, always read from
 * `comments_read`.
 */

export const commentInputSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  isAnonymous: z.boolean().default(false),
});

export type CommentInput = z.input<typeof commentInputSchema>;

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  depth: number;
  body: string;
  isAnonymous: boolean;
  author: { handle: string; avatarSeed: string } | null;
  /** The author's id when not anonymous, for an OP or Mod badge; null otherwise. */
  publicAuthorId: string | null;
  isOwn: boolean;
  /** The viewer's own vote, 0 when none. */
  myVote: -1 | 0 | 1;
  saved: boolean;
  upVotes: number;
  downVotes: number;
  score: number;
  createdAt: Date;
  editedAt: Date | null;
  removedAt: Date | null;
  deletedAt: Date | null;
}

type ReadRow = typeof commentsRead.$inferSelect;
const COMMENT = getViewSelectedFields(commentsRead);

function toView(
  row: ReadRow,
  handle: string | null,
  avatarSeed: string | null,
  viewer: { myVote?: number | null; saved?: boolean } = {},
): CommentView {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    depth: row.depth,
    body: row.body,
    isAnonymous: row.isAnonymous,
    author: !row.isAnonymous && handle && avatarSeed ? { handle, avatarSeed } : null,
    publicAuthorId: row.isAnonymous ? null : row.publicAuthorId,
    isOwn: row.isOwn === true,
    myVote: viewer.myVote === 1 ? 1 : viewer.myVote === -1 ? -1 : 0,
    saved: viewer.saved === true,
    upVotes: row.upVotes,
    downVotes: row.downVotes,
    score: row.score,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    removedAt: row.removedAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * Reply to a post, or to a comment on it. A verified member with
 * `communities.comment` here, not banned, on a live unlocked post, within the
 * depth cap and the rate limit.
 */
export async function createComment(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  parentId: string | null,
  input: CommentInput,
  settings: CommunitiesSettings,
): Promise<Result<{ id: string }, Refusal>> {
  const parsed = commentInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const c = parsed.data;

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [post] = await tx
      .select()
      .from(postsRead)
      .where(
        and(eq(postsRead.id, postId), isNull(postsRead.deletedAt), isNull(postsRead.removedAt)),
      );
    if (!post) return err('not_found');
    if (post.lockedAt) return err('locked');
    const [community] = await tx
      .select()
      .from(communities)
      .where(eq(communities.id, post.communityId));
    if (!community || community.deletedAt) return err('not_found');
    if (community.archivedAt) return err('archived');
    if (c.isAnonymous && (!community.allowAnonymous || settings.anonymousPosting !== 'on')) {
      return err('anonymous_not_allowed');
    }
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, post.communityId)) return err('banned');
    if (
      !(await canInCommunity(tx, actor.userId, tenantId, post.communityId, 'communities.comment'))
    ) {
      return err('not_allowed');
    }
    if ((await ownCommentsLastHour(tx, tenantId)) >= LIMITS.commentsPerHour) {
      return err('rate_limited');
    }

    let parentPath: string | null = null;
    let depth = 0;
    if (parentId) {
      const [parent] = await tx
        .select({ path: commentsRead.path, depth: commentsRead.depth })
        .from(commentsRead)
        .where(and(eq(commentsRead.id, parentId), eq(commentsRead.postId, postId)));
      if (!parent) return err('not_found');
      if (!canReplyAt(parent.depth, settings.commentDepth)) return err('depth');
      parentPath = parent.path;
      depth = parent.depth + 1;
    }

    const id = randomUUID();
    await tx.insert(comments).values({
      id,
      tenantId,
      postId,
      parentId,
      path: childPath(parentPath, id),
      depth,
      authorId: actor.userId,
      isAnonymous: c.isAnonymous,
      body: c.body,
    });
    await tx
      .update(posts)
      .set({ commentCount: sql`${posts.commentCount} + 1` })
      .where(eq(posts.id, postId));
    return ok({ id });
  });
}

/** Edit your own comment. The previous text is kept; the comment shows as edited. */
export async function editComment(
  actor: { userId: string },
  tenantId: string,
  commentId: string,
  body: string,
): Promise<Result<{ edited: boolean }, Refusal>> {
  const text = body.trim();
  if (text.length === 0 || text.length > 10_000) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [own] = await tx
      .select()
      .from(commentsRead)
      .where(and(eq(commentsRead.id, commentId), isNull(commentsRead.deletedAt)));
    if (!own) return err('not_found');
    if (!own.isOwn) return err('not_allowed');
    if (own.removedAt) return err('locked');
    await tx.insert(commentEdits).values({ tenantId, commentId, previousBody: own.body });
    await tx
      .update(comments)
      .set({ body: text, editedAt: new Date() })
      .where(eq(comments.id, commentId));
    return ok({ edited: true });
  });
}

/** Delete your own comment. Soft: it shows as "[deleted]" and keeps its replies. */
export async function deleteComment(
  actor: { userId: string },
  tenantId: string,
  commentId: string,
): Promise<Result<{ deleted: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [own] = await tx
      .select({ isOwn: commentsRead.isOwn, deletedAt: commentsRead.deletedAt })
      .from(commentsRead)
      .where(eq(commentsRead.id, commentId));
    if (!own) return err('not_found');
    if (!own.isOwn) return err('not_allowed');
    if (own.deletedAt) return ok({ deleted: false });
    await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    return ok({ deleted: true });
  });
}

export type CommentSort = 'best' | 'top' | 'new' | 'old' | 'controversial';

function keyFor(sort: CommentSort): (r: ReadRow) => number {
  switch (sort) {
    case 'top':
      return (r) => -r.score;
    case 'new':
      return (r) => -r.createdAt.getTime();
    case 'old':
      return (r) => r.createdAt.getTime();
    case 'controversial':
      return (r) => -Number(r.controversy);
    default:
      return (r) => -Number(r.bestScore);
  }
}

async function readTree(
  tx: TenantTransaction,
  postId: string,
  sort: CommentSort,
): Promise<CommentView[]> {
  const rows = await tx
    .select({
      comment: COMMENT,
      handle: publicProfiles.handle,
      avatarSeed: publicProfiles.avatarSeed,
      myVote: commentVotes.value,
      saved: savedItems.itemId,
    })
    .from(commentsRead)
    .leftJoin(publicProfiles, eq(publicProfiles.userId, commentsRead.publicAuthorId))
    // Own-row tables: these joins yield the viewer's rows and nobody else's.
    .leftJoin(commentVotes, eq(commentVotes.commentId, commentsRead.id))
    .leftJoin(
      savedItems,
      and(eq(savedItems.itemType, 'comment'), eq(savedItems.itemId, commentsRead.id)),
    )
    .where(eq(commentsRead.postId, postId))
    .orderBy(asc(commentsRead.path));

  // Siblings sorted by the chosen key, the tree walked depth first.
  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const list = byParent.get(r.comment.parentId) ?? [];
    list.push(r);
    byParent.set(r.comment.parentId, list);
  }
  const key = keyFor(sort);
  const out: CommentView[] = [];
  const walk = (parentId: string | null) => {
    const children = byParent.get(parentId) ?? [];
    children.sort((a, b) => key(a.comment) - key(b.comment));
    for (const child of children) {
      out.push(
        toView(child.comment, child.handle, child.avatarSeed, {
          myVote: child.myVote,
          saved: child.saved !== null,
        }),
      );
      walk(child.comment.id);
    }
  };
  walk(null);
  return out;
}

/** Every comment on a post in tree order, siblings sorted, as this viewer sees them. */
export async function commentsForPost(
  viewer: { userId: string } | null,
  tenantId: string,
  postId: string,
  sort: CommentSort = 'best',
): Promise<CommentView[]> {
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) => readTree(tx, postId, sort))
    : withTenant(tenantId, (tx) => readTree(tx, postId, sort));
}
