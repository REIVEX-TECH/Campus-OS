import { and, eq, inArray } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';
import { withMigrationClient } from '@campusos/db/migrate';
import { communityKarma, karmaPublic } from './schema/communities';

/**
 * Karma: what other people did.
 *
 * Upvotes received less downvotes received, on posts and comments, per tenant,
 * and nothing at all for viewing, signing in, joining, saving, or for posting
 * itself. There is no path from an action of your own to a number of your own,
 * which is what stops it being farmed by turning up.
 *
 * The numbers are moved by `communities_karma_vote` in the same transaction as
 * the vote that causes them (0006), because the author of an anonymous item is
 * a column the application role may not read. This file only reads them back.
 *
 * Two totals, and the difference matters. The public one counts signed items
 * only and is what a thread may show; the private one counts anonymous items
 * too and is the person's own. A public number that moved when an anonymous
 * post was voted on would name its author to anyone watching both.
 */

export interface Karma {
  posts: number;
  comments: number;
  total: number;
}

/** Someone's own karma: what everyone sees, and what only they do. */
export interface OwnKarma extends Karma {
  publicPosts: number;
  publicComments: number;
  publicTotal: number;
}

const NONE: Karma = { posts: 0, comments: 0, total: 0 };

/** The signed half, for anyone. Zero for a person who has never been voted on. */
export async function publicKarma(tenantId: string, userId: string): Promise<Karma> {
  const found = await publicKarmaFor(tenantId, [userId]);
  return found.get(userId) ?? NONE;
}

/**
 * The signed half for several people at once, keyed by user id.
 *
 * One query for a page rather than one per handle: a thread of fifty comments
 * would otherwise ask fifty times for a number nobody scrolled to.
 */
export async function publicKarmaFor(
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, Karma>> {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return new Map();
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(karmaPublic)
      .where(and(eq(karmaPublic.tenantId, tenantId), inArray(karmaPublic.userId, wanted)));
    return new Map(
      rows.map((r) => [r.userId, { posts: r.postKarma, comments: r.commentKarma, total: r.karma }]),
    );
  });
}

/**
 * A person's own karma, including what they wrote anonymously.
 *
 * Their own row, which the policy on `community_karma` limits them to, so this
 * cannot be asked about anybody else however it is called.
 */
export async function ownKarma(actor: { userId: string }, tenantId: string): Promise<OwnKarma> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(communityKarma)
      .where(and(eq(communityKarma.tenantId, tenantId), eq(communityKarma.userId, actor.userId)));
    if (!row) return { ...NONE, publicPosts: 0, publicComments: 0, publicTotal: 0 };
    return {
      posts: row.postKarma,
      comments: row.commentKarma,
      total: row.postKarma + row.commentKarma,
      publicPosts: row.publicPostKarma,
      publicComments: row.publicCommentKarma,
      publicTotal: row.publicPostKarma + row.publicCommentKarma,
    };
  });
}

/**
 * Rebuild a tenant's karma from its votes, and say how many were counted.
 *
 * The repair for any drift, and the reason the table is a cache rather than
 * the record. Runs as the owner: recomputing means reading every author, and
 * the application role has no business doing that, so this is for the script
 * and not for a request.
 */
export async function recomputeKarma(tenantId: string): Promise<number> {
  return withMigrationClient(async (client) => {
    const rows = await client`select communities_karma_recompute(${tenantId}) as n`;
    return Number(rows[0]?.n ?? 0);
  });
}
