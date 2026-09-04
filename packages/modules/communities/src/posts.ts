import { and, desc, eq, getViewSelectedFields, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import {
  canInCommunity,
  isBanned,
  isVerifiedMember,
  LIMITS,
  ownPostsLastHour,
  type Refusal,
} from './access';
import { hotScore } from './domain/ranking';
import type { CommunitiesSettings } from './manifest';
import { communities, postEdits, posts, postsRead, publicProfiles } from './schema/communities';

/**
 * Posts: text and link. Written to `posts`, always read from `posts_read`, so
 * no code path in this module can see an author the view does not show.
 */

export const postInputSchema = z
  .object({
    kind: z.enum(['text', 'link']),
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().max(40_000).optional(),
    url: z.string().trim().url().max(2048).optional(),
    isAnonymous: z.boolean().default(false),
    spoiler: z.boolean().default(false),
  })
  .refine((p) => p.kind !== 'link' || Boolean(p.url), { message: 'a link post needs a url' });

export type PostInput = z.input<typeof postInputSchema>;

/** The bare host of an http(s) url, for display next to a link post; null otherwise. */
export function domainOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export interface PostAuthor {
  handle: string;
  avatarSeed: string;
}

export interface PostView {
  id: string;
  communityId: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  urlDomain: string | null;
  isAnonymous: boolean;
  spoiler: boolean;
  /** Null when anonymous, or when the author's account is gone. */
  author: PostAuthor | null;
  isOwn: boolean;
  upVotes: number;
  downVotes: number;
  score: number;
  commentCount: number;
  createdAt: Date;
  editedAt: Date | null;
  pinnedAt: Date | null;
  lockedAt: Date | null;
  removedAt: Date | null;
  deletedAt: Date | null;
}

type ReadRow = typeof postsRead.$inferSelect;
/** The view's columns as a selectable map: a view cannot be nested in a select the way a table can. */
const POST = getViewSelectedFields(postsRead);

function toView(row: ReadRow, handle: string | null, avatarSeed: string | null): PostView {
  return {
    id: row.id,
    communityId: row.communityId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    urlDomain: row.urlDomain,
    isAnonymous: row.isAnonymous,
    spoiler: row.spoiler,
    author: !row.isAnonymous && handle && avatarSeed ? { handle, avatarSeed } : null,
    isOwn: row.isOwn === true,
    upVotes: row.upVotes,
    downVotes: row.downVotes,
    score: row.score,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    pinnedAt: row.pinnedAt,
    lockedAt: row.lockedAt,
    removedAt: row.removedAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * Create a post. A verified member holding `communities.post` here, not
 * banned, in a live community that allows the kind (and anonymity, if asked
 * for), within the rate limits, and not a repeat of a link posted here today.
 */
export async function createPost(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: PostInput,
  settings: CommunitiesSettings,
): Promise<Result<{ id: string }, Refusal>> {
  const parsed = postInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const p = parsed.data;
  const urlDomain = p.kind === 'link' && p.url ? domainOf(p.url) : null;
  if (p.kind === 'link' && !urlDomain) return err('invalid');

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [community] = await tx
      .select()
      .from(communities)
      .where(and(eq(communities.id, communityId), isNull(communities.deletedAt)));
    if (!community || community.approvalStatus !== 'approved') return err('not_found');
    if (community.archivedAt) return err('archived');
    if (!community.allowedKinds.includes(p.kind)) return err('kind_not_allowed');
    if (p.isAnonymous && (!community.allowAnonymous || settings.anonymousPosting !== 'on')) {
      return err('anonymous_not_allowed');
    }
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (await isBanned(tx, actor.userId, tenantId, communityId)) return err('banned');
    if (!(await canInCommunity(tx, actor.userId, tenantId, communityId, 'communities.post'))) {
      return err('not_allowed');
    }
    if ((await ownPostsLastHour(tx, tenantId)) >= LIMITS.postsPerHour) return err('rate_limited');
    if (
      p.isAnonymous &&
      (await ownPostsLastHour(tx, tenantId, true)) >= LIMITS.anonymousPostsPerHour
    ) {
      return err('rate_limited');
    }
    if (p.url) {
      const dup = await tx
        .select({ id: postsRead.id })
        .from(postsRead)
        .where(
          and(
            eq(postsRead.communityId, communityId),
            eq(postsRead.url, p.url),
            isNull(postsRead.deletedAt),
            sql`${postsRead.createdAt} > now() - interval '1 day'`,
          ),
        )
        .limit(1);
      if (dup.length > 0) return err('exists');
    }

    const now = new Date();
    const [row] = await tx
      .insert(posts)
      .values({
        tenantId,
        communityId,
        authorId: actor.userId,
        kind: p.kind,
        title: p.title,
        body: p.body ?? (p.kind === 'text' ? '' : null),
        url: p.url ?? null,
        urlDomain,
        isAnonymous: p.isAnonymous,
        spoiler: p.spoiler,
        hotScore: hotScore(0, 0, now).toFixed(7),
        createdAt: now,
      })
      .returning({ id: posts.id });
    return ok({ id: row!.id });
  });
}

/** Edit your own post. The previous text is kept; the post shows as edited. */
export async function editPost(
  actor: { userId: string },
  tenantId: string,
  postId: string,
  input: { title: string; body?: string },
): Promise<Result<{ edited: boolean }, Refusal>> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 300) return err('invalid');
  const body = input.body?.trim() ?? null;
  if (body && body.length > 40_000) return err('invalid');

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [own] = await tx
      .select()
      .from(postsRead)
      .where(and(eq(postsRead.id, postId), isNull(postsRead.deletedAt)));
    if (!own) return err('not_found');
    if (!own.isOwn) return err('not_allowed');
    if (own.lockedAt || own.removedAt) return err('locked');
    await tx.insert(postEdits).values({
      tenantId,
      postId,
      previousTitle: own.title,
      previousBody: own.body,
    });
    await tx.update(posts).set({ title, body, editedAt: new Date() }).where(eq(posts.id, postId));
    return ok({ edited: true });
  });
}

/** Delete your own post. Soft: the row stays, the tree under it stays. */
export async function deletePost(
  actor: { userId: string },
  tenantId: string,
  postId: string,
): Promise<Result<{ deleted: boolean }, Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [own] = await tx
      .select({ isOwn: postsRead.isOwn, deletedAt: postsRead.deletedAt })
      .from(postsRead)
      .where(eq(postsRead.id, postId));
    if (!own) return err('not_found');
    if (!own.isOwn) return err('not_allowed');
    if (own.deletedAt) return ok({ deleted: false });
    await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
    return ok({ deleted: true });
  });
}

async function readOne(tx: TenantTransaction, postId: string): Promise<PostView | null> {
  const [row] = await tx
    .select({
      post: POST,
      handle: publicProfiles.handle,
      avatarSeed: publicProfiles.avatarSeed,
    })
    .from(postsRead)
    .leftJoin(publicProfiles, eq(publicProfiles.userId, postsRead.publicAuthorId))
    .where(eq(postsRead.id, postId));
  return row ? toView(row.post, row.handle, row.avatarSeed) : null;
}

/** One post as this viewer sees it, or as a stranger sees it when there is no viewer. */
export async function postById(
  viewer: { userId: string } | null,
  tenantId: string,
  postId: string,
): Promise<PostView | null> {
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) => readOne(tx, postId))
    : withTenant(tenantId, (tx) => readOne(tx, postId));
}

/**
 * A person's public post history: what they wrote under their handle. Filtered
 * on the generated public author column, which is null for anonymous posts,
 * so the anonymous ones cannot appear here whatever the caller passes.
 */
export async function postsByAuthor(
  tenantId: string,
  authorUserId: string,
  limit = 20,
): Promise<PostView[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        post: POST,
        handle: publicProfiles.handle,
        avatarSeed: publicProfiles.avatarSeed,
      })
      .from(postsRead)
      .leftJoin(publicProfiles, eq(publicProfiles.userId, postsRead.publicAuthorId))
      .where(
        and(
          eq(postsRead.tenantId, tenantId),
          eq(postsRead.publicAuthorId, authorUserId),
          isNull(postsRead.deletedAt),
          isNull(postsRead.removedAt),
        ),
      )
      .orderBy(desc(postsRead.createdAt))
      .limit(limit);
    return rows.map((r) => toView(r.post, r.handle, r.avatarSeed));
  });
}

/** The person's own anonymous posts, for their private list. Needs the actor. */
export async function myAnonymousPosts(
  actor: { userId: string },
  tenantId: string,
  limit = 20,
): Promise<PostView[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = await tx
      .select({ post: POST })
      .from(postsRead)
      .where(
        and(
          eq(postsRead.tenantId, tenantId),
          eq(postsRead.isOwn, true),
          eq(postsRead.isAnonymous, true),
          isNull(postsRead.deletedAt),
        ),
      )
      .orderBy(desc(postsRead.createdAt))
      .limit(limit);
    return rows.map((r) => toView(r.post, null, null));
  });
}
