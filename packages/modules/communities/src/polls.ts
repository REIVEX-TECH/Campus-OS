import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInCommunity, isBanned, isVerifiedMember, type Refusal } from './access';
import { pollOptions, pollVotes, postsRead } from './schema/communities';

/**
 * Polls: a post kind with two to six options and a closing time. One vote per
 * person, final, kept in `poll_votes` under an own row policy, so who chose
 * what is nobody else's to read; the counts live on the options and move in
 * the same transaction as the vote. Everything is read through `posts_read`,
 * so an anonymous poll's author stays unknown here as everywhere.
 */

export const pollInputSchema = z.object({
  options: z
    .array(z.string().trim().min(1).max(80))
    .min(2)
    .max(6)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, {
      message: 'options repeat',
    }),
  /** How long voting stays open, from posting. */
  closesInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(72),
});
export type PollInput = z.input<typeof pollInputSchema>;

export interface PollOptionView {
  id: string;
  text: string;
  votes: number;
  /** Whole percent of the total; 0 when nobody voted. */
  share: number;
}

export interface PollView {
  options: PollOptionView[];
  total: number;
  closesAt: Date;
  closed: boolean;
  /** The viewer's own choice, or null. */
  myOptionId: string | null;
}

/** Write a poll's options with its post, inside the post's own transaction. */
export async function writePollOptions(
  tx: TenantTransaction,
  tenantId: string,
  postId: string,
  options: string[],
): Promise<void> {
  await tx
    .insert(pollOptions)
    .values(options.map((text, i) => ({ tenantId, postId, position: i + 1, text })));
}

async function readPoll(
  tx: TenantTransaction,
  postId: string,
  viewer: { userId: string } | null,
): Promise<PollView | null> {
  const [post] = await tx
    .select({ kind: postsRead.kind, closesAt: postsRead.pollClosesAt })
    .from(postsRead)
    .where(eq(postsRead.id, postId));
  if (!post || post.kind !== 'poll' || !post.closesAt) return null;
  const rows = await tx
    .select({
      id: pollOptions.id,
      text: pollOptions.text,
      votes: pollOptions.voteCount,
      // Own-row table: this join yields the viewer's vote and nobody else's.
      mine: viewer ? pollVotes.optionId : sql<string | null>`null`,
    })
    .from(pollOptions)
    .leftJoin(pollVotes, eq(pollVotes.optionId, pollOptions.id))
    .where(eq(pollOptions.postId, postId))
    .orderBy(asc(pollOptions.position));
  const total = rows.reduce((n, r) => n + r.votes, 0);
  return {
    options: rows.map((r) => ({
      id: r.id,
      text: r.text,
      votes: r.votes,
      share: total > 0 ? Math.round((r.votes / total) * 100) : 0,
    })),
    total,
    closesAt: post.closesAt,
    closed: post.closesAt.getTime() <= Date.now(),
    myOptionId: rows.find((r) => r.mine !== null)?.id ?? null,
  };
}

/** A poll as this viewer sees it: the counts for everyone, their own choice for them alone. */
export async function pollFor(
  viewer: { userId: string } | null,
  tenantId: string,
  postId: string,
): Promise<PollView | null> {
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) => readPoll(tx, postId, viewer))
    : withTenant(tenantId, (tx) => readPoll(tx, postId, null));
}

/** Cast the one vote. Members with `communities.vote`, while the poll is open; a second vote is `exists`. */
export async function votePoll(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  optionId: string,
): Promise<Result<PollView, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [post] = await tx
      .select()
      .from(postsRead)
      .where(
        and(eq(postsRead.id, postId), isNull(postsRead.deletedAt), isNull(postsRead.removedAt)),
      );
    if (!post || post.kind !== 'poll' || !post.pollClosesAt) return err('not_found');
    if (post.lockedAt) return err('locked');
    if (post.pollClosesAt.getTime() <= Date.now()) return err('closed');
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, post.communityId)) return err('banned');
    if (!(await canInCommunity(tx, actor.userId, tenantId, post.communityId, 'communities.vote'))) {
      return err('not_allowed');
    }
    const [option] = await tx
      .select({ id: pollOptions.id })
      .from(pollOptions)
      .where(and(eq(pollOptions.id, optionId), eq(pollOptions.postId, postId)));
    if (!option) return err('invalid');
    const inserted = await tx
      .insert(pollVotes)
      .values({ tenantId, postId, optionId, userId: actor.userId })
      .onConflictDoNothing()
      .returning({ optionId: pollVotes.optionId });
    if (inserted.length === 0) return err('exists');
    await tx
      .update(pollOptions)
      .set({ voteCount: sql`${pollOptions.voteCount} + 1` })
      .where(eq(pollOptions.id, optionId));
    const view = await readPoll(tx, postId, actor);
    return view ? ok(view) : err('not_found');
  });
}
