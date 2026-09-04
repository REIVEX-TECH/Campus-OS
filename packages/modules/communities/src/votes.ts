import { and, eq, getViewSelectedFields, isNull, sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInCommunity, isBanned, isVerifiedMember, LIMITS, type Refusal } from './access';
import { controversyScore, hotScore, wilsonLowerBound } from './domain/ranking';
import {
  commentVotes,
  comments,
  commentsRead,
  postVotes,
  posts,
  postsRead,
} from './schema/communities';

/**
 * Votes. One row per person per item, so a second vote changes rather than
 * adds; the tallies on the item move by the difference, atomically, and the
 * ranking columns are recomputed from the tallies in the same transaction.
 */

export type VoteValue = -1 | 0 | 1;

export interface Tally {
  upVotes: number;
  downVotes: number;
  score: number;
}

async function votesLastHour(tx: TenantTransaction, tenantId: string): Promise<number> {
  const rows = [
    ...(await tx.execute(sql`
      select (select count(*) from post_votes where tenant_id = ${tenantId} and created_at > now() - interval '1 hour')
           + (select count(*) from comment_votes where tenant_id = ${tenantId} and created_at > now() - interval '1 hour') as n`)),
  ] as { n: number | string }[];
  return Number(rows[0]?.n ?? 0);
}

function deltas(previous: VoteValue, next: VoteValue): { up: number; down: number } {
  let up = 0;
  let down = 0;
  if (previous === 1) up -= 1;
  if (previous === -1) down -= 1;
  if (next === 1) up += 1;
  if (next === -1) down += 1;
  return { up, down };
}

export async function votePost(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  value: VoteValue,
): Promise<Result<Tally, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [post] = await tx
      .select()
      .from(postsRead)
      .where(
        and(eq(postsRead.id, postId), isNull(postsRead.deletedAt), isNull(postsRead.removedAt)),
      );
    if (!post) return err('not_found');
    if (post.lockedAt) return err('locked');
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, post.communityId)) return err('banned');
    if (!(await canInCommunity(tx, actor.userId, tenantId, post.communityId, 'communities.vote'))) {
      return err('not_allowed');
    }

    const [existing] = await tx
      .select({ value: postVotes.value })
      .from(postVotes)
      .where(and(eq(postVotes.postId, postId), eq(postVotes.userId, actor.userId)));
    const previous = (existing?.value ?? 0) as VoteValue;
    if (previous === value) {
      return ok({ upVotes: post.upVotes, downVotes: post.downVotes, score: post.score });
    }
    if (!existing && (await votesLastHour(tx, tenantId)) >= LIMITS.votesPerHour) {
      return err('rate_limited');
    }

    if (value === 0) {
      await tx
        .delete(postVotes)
        .where(and(eq(postVotes.postId, postId), eq(postVotes.userId, actor.userId)));
    } else if (existing) {
      await tx
        .update(postVotes)
        .set({ value })
        .where(and(eq(postVotes.postId, postId), eq(postVotes.userId, actor.userId)));
    } else {
      await tx.insert(postVotes).values({ tenantId, postId, userId: actor.userId, value });
    }

    const d = deltas(previous, value);
    const [tally] = await tx
      .update(posts)
      .set({
        upVotes: sql`${posts.upVotes} + ${d.up}`,
        downVotes: sql`${posts.downVotes} + ${d.down}`,
        score: sql`${posts.score} + ${d.up - d.down}`,
      })
      .where(eq(posts.id, postId))
      .returning({
        upVotes: posts.upVotes,
        downVotes: posts.downVotes,
        score: posts.score,
        createdAt: posts.createdAt,
      });
    await tx
      .update(posts)
      .set({
        hotScore: hotScore(tally!.upVotes, tally!.downVotes, tally!.createdAt).toFixed(7),
        controversy: controversyScore(tally!.upVotes, tally!.downVotes).toFixed(7),
      })
      .where(eq(posts.id, postId));
    return ok({ upVotes: tally!.upVotes, downVotes: tally!.downVotes, score: tally!.score });
  });
}

export async function voteComment(
  actor: { userId: string },
  tenantId: string,
  commentId: string,
  value: VoteValue,
): Promise<Result<Tally, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [comment] = await tx
      .select({
        comment: getViewSelectedFields(commentsRead),
        communityId: postsRead.communityId,
        lockedAt: postsRead.lockedAt,
      })
      .from(commentsRead)
      .innerJoin(postsRead, eq(postsRead.id, commentsRead.postId))
      .where(
        and(
          eq(commentsRead.id, commentId),
          isNull(commentsRead.deletedAt),
          isNull(commentsRead.removedAt),
        ),
      );
    if (!comment) return err('not_found');
    if (comment.lockedAt) return err('locked');
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, comment.communityId)) return err('banned');
    if (
      !(await canInCommunity(tx, actor.userId, tenantId, comment.communityId, 'communities.vote'))
    ) {
      return err('not_allowed');
    }

    const [existing] = await tx
      .select({ value: commentVotes.value })
      .from(commentVotes)
      .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.userId, actor.userId)));
    const previous = (existing?.value ?? 0) as VoteValue;
    const current = comment.comment;
    if (previous === value) {
      return ok({ upVotes: current.upVotes, downVotes: current.downVotes, score: current.score });
    }
    if (!existing && (await votesLastHour(tx, tenantId)) >= LIMITS.votesPerHour) {
      return err('rate_limited');
    }

    if (value === 0) {
      await tx
        .delete(commentVotes)
        .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.userId, actor.userId)));
    } else if (existing) {
      await tx
        .update(commentVotes)
        .set({ value })
        .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.userId, actor.userId)));
    } else {
      await tx.insert(commentVotes).values({ tenantId, commentId, userId: actor.userId, value });
    }

    const d = deltas(previous, value);
    const [tally] = await tx
      .update(comments)
      .set({
        upVotes: sql`${comments.upVotes} + ${d.up}`,
        downVotes: sql`${comments.downVotes} + ${d.down}`,
        score: sql`${comments.score} + ${d.up - d.down}`,
      })
      .where(eq(comments.id, commentId))
      .returning({
        upVotes: comments.upVotes,
        downVotes: comments.downVotes,
        score: comments.score,
      });
    await tx
      .update(comments)
      .set({
        bestScore: wilsonLowerBound(tally!.upVotes, tally!.downVotes).toFixed(7),
        controversy: controversyScore(tally!.upVotes, tally!.downVotes).toFixed(7),
      })
      .where(eq(comments.id, commentId));
    return ok({ upVotes: tally!.upVotes, downVotes: tally!.downVotes, score: tally!.score });
  });
}
