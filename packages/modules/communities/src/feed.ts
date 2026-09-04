import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import { POST, toPostView, type PostView, type ReadRow } from './posts';
import {
  communities,
  communityMemberships,
  postVotes,
  postsRead,
  publicProfiles,
  savedItems,
} from './schema/communities';

/**
 * Lists of posts: one community, everything public in the tenant (All), or
 * the communities a person joined (Home), in any of the five sorts, paged by
 * keyset cursor. The ranking columns are precomputed on write (see votes.ts),
 * so every sort is an index order; rising is the one read-time computation and
 * is bounded to a day, so it is a single small page rather than a cursor.
 * Pages are pages: the caller renders a "more" link, never an infinite scroll.
 */

export type FeedSort = 'hot' | 'new' | 'top' | 'rising' | 'controversial';
export type TopWindow = 'hour' | 'day' | 'week' | 'month' | 'all';
export type FeedScope =
  { kind: 'community'; communityId: string } | { kind: 'all' } | { kind: 'home' };

export const FEED_SORTS: readonly FeedSort[] = ['hot', 'new', 'top', 'rising', 'controversial'];
export const TOP_WINDOWS: readonly TopWindow[] = ['hour', 'day', 'week', 'month', 'all'];

export function isFeedSort(value: string | undefined): value is FeedSort {
  return (FEED_SORTS as readonly string[]).includes(value ?? '');
}

export function isTopWindow(value: string | undefined): value is TopWindow {
  return (TOP_WINDOWS as readonly string[]).includes(value ?? '');
}

export interface FeedOptions {
  sort?: FeedSort;
  /** For `top` only. */
  window?: TopWindow;
  cursor?: string;
  limit?: number;
}

export interface PostPage {
  items: PostView[];
  /** Opaque; pass back as `cursor` for the next page. Null at the end. */
  nextCursor: string | null;
}

export const PAGE_SIZE = 25;
const RISING_HOURS = 24;

const WINDOW_MS: Record<TopWindow, number | null> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  all: null,
};

export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(parts.join('|')).toString('base64url');
}

export function decodeCursor(cursor: string, arity: number): string[] | null {
  try {
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    return parts.length === arity && parts.every((p) => p.length > 0) ? parts : null;
  } catch {
    return null;
  }
}

/** How a sort orders, continues from a cursor, and names the cursor of a row. */
function plan(sort: FeedSort, cursor: string | undefined) {
  switch (sort) {
    case 'new': {
      const after = cursor ? decodeCursor(cursor, 2) : null;
      return {
        order: [desc(postsRead.createdAt), desc(postsRead.id)],
        where: after
          ? or(
              lt(postsRead.createdAt, new Date(after[0]!)),
              and(eq(postsRead.createdAt, new Date(after[0]!)), lt(postsRead.id, after[1]!)),
            )
          : undefined,
        cursorOf: (r: ReadRow) => encodeCursor([r.createdAt.toISOString(), r.id]),
        pageable: true,
      };
    }
    case 'top': {
      const after = cursor ? decodeCursor(cursor, 3) : null;
      return {
        order: [desc(postsRead.score), desc(postsRead.createdAt), desc(postsRead.id)],
        where: after
          ? or(
              lt(postsRead.score, Number(after[0])),
              and(
                eq(postsRead.score, Number(after[0])),
                or(
                  lt(postsRead.createdAt, new Date(after[1]!)),
                  and(eq(postsRead.createdAt, new Date(after[1]!)), lt(postsRead.id, after[2]!)),
                ),
              ),
            )
          : undefined,
        cursorOf: (r: ReadRow) => encodeCursor([String(r.score), r.createdAt.toISOString(), r.id]),
        pageable: true,
      };
    }
    case 'controversial': {
      const after = cursor ? decodeCursor(cursor, 2) : null;
      return {
        order: [desc(postsRead.controversy), desc(postsRead.id)],
        where: after
          ? or(
              lt(postsRead.controversy, after[0]!),
              and(eq(postsRead.controversy, after[0]!), lt(postsRead.id, after[1]!)),
            )
          : undefined,
        cursorOf: (r: ReadRow) => encodeCursor([r.controversy, r.id]),
        pageable: true,
      };
    }
    case 'rising':
      return {
        // Score per hour of age, with a floor so a minute old post is not infinite.
        order: [
          sql`${postsRead.score} / greatest(extract(epoch from now() - ${postsRead.createdAt}) / 3600.0, 0.5) desc`,
          desc(postsRead.createdAt),
        ],
        where: gt(postsRead.createdAt, new Date(Date.now() - RISING_HOURS * 3_600_000)),
        cursorOf: () => '',
        pageable: false,
      };
    default: {
      const after = cursor ? decodeCursor(cursor, 2) : null;
      return {
        order: [desc(postsRead.hotScore), desc(postsRead.id)],
        where: after
          ? or(
              lt(postsRead.hotScore, after[0]!),
              and(eq(postsRead.hotScore, after[0]!), lt(postsRead.id, after[1]!)),
            )
          : undefined,
        cursorOf: (r: ReadRow) => encodeCursor([r.hotScore, r.id]),
        pageable: true,
      };
    }
  }
}

function scopeWhere(
  tx: TenantTransaction,
  tenantId: string,
  scope: FeedScope,
  viewer: { userId: string } | null,
): SQL | undefined {
  switch (scope.kind) {
    case 'community':
      return eq(postsRead.communityId, scope.communityId);
    case 'all':
      // Public, live communities only: a restricted community's posts are for its members.
      return inArray(
        postsRead.communityId,
        tx
          .select({ id: communities.id })
          .from(communities)
          .where(
            and(
              eq(communities.tenantId, tenantId),
              eq(communities.visibility, 'public'),
              eq(communities.approvalStatus, 'approved'),
              isNull(communities.deletedAt),
            ),
          ),
      );
    case 'home':
      return viewer
        ? inArray(
            postsRead.communityId,
            tx
              .select({ id: communityMemberships.communityId })
              .from(communityMemberships)
              .where(
                and(
                  eq(communityMemberships.tenantId, tenantId),
                  eq(communityMemberships.userId, viewer.userId),
                  isNull(communityMemberships.leftAt),
                ),
              ),
          )
        : sql`false`;
  }
}

function selectPosts(tx: TenantTransaction) {
  return (
    tx
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
      .leftJoin(
        savedItems,
        and(eq(savedItems.itemType, 'post'), eq(savedItems.itemId, postsRead.id)),
      )
  );
}

/** What the viewer chose not to see: what they hid, and who they blocked (by public author). */
function viewerFilters(viewer: { userId: string } | null): SQL[] {
  if (!viewer) return [];
  return [
    sql`not exists (select 1 from hidden_items h where h.item_type = 'post' and h.item_id = ${postsRead.id} and h.user_id = ${viewer.userId}::uuid)`,
    sql`not exists (select 1 from user_blocks b where b.blocker_id = ${viewer.userId}::uuid and b.blocked_id = ${postsRead.publicAuthorId})`,
  ];
}

async function page(
  tx: TenantTransaction,
  tenantId: string,
  viewer: { userId: string } | null,
  scope: FeedScope,
  options: FeedOptions,
): Promise<PostPage> {
  const sort = options.sort ?? 'hot';
  const limit = Math.min(Math.max(1, options.limit ?? PAGE_SIZE), 100);
  const p = plan(sort, options.cursor);
  const windowMs = sort === 'top' ? WINDOW_MS[options.window ?? 'day'] : null;
  const live = [isNull(postsRead.deletedAt), isNull(postsRead.removedAt), ...viewerFilters(viewer)];
  const shape = (r: Awaited<ReturnType<ReturnType<typeof selectPosts>['execute']>>[number]) =>
    toPostView(
      r.post,
      r.handle,
      r.avatarSeed,
      { myVote: r.myVote, saved: r.saved !== null },
      { slug: r.communitySlug, name: r.communityName },
    );

  // A community's pinned posts lead its first page, in every sort, outside the cursor.
  const pinned =
    scope.kind === 'community' && !options.cursor
      ? await selectPosts(tx)
          .where(
            and(
              eq(postsRead.tenantId, tenantId),
              eq(postsRead.communityId, scope.communityId),
              isNotNull(postsRead.pinnedAt),
              ...live,
            ),
          )
          .orderBy(desc(postsRead.pinnedAt))
          .limit(10)
      : [];

  const rows = await selectPosts(tx)
    .where(
      and(
        eq(postsRead.tenantId, tenantId),
        scopeWhere(tx, tenantId, scope, viewer),
        scope.kind === 'community' ? isNull(postsRead.pinnedAt) : undefined,
        ...live,
        p.where,
        windowMs ? gt(postsRead.createdAt, new Date(Date.now() - windowMs)) : undefined,
      ),
    )
    .orderBy(...p.order)
    .limit(limit + 1);
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    items: [...pinned.map(shape), ...shown.map(shape)],
    nextCursor: p.pageable && rows.length > limit && last ? p.cursorOf(last.post) : null,
  };
}

/** Posts in a scope, sorted and paged, as this viewer (or a stranger) sees them. */
export async function listPosts(
  viewer: { userId: string } | null,
  tenantId: string,
  scope: FeedScope,
  options: FeedOptions = {},
): Promise<PostPage> {
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) => page(tx, tenantId, viewer, scope, options))
    : withTenant(tenantId, (tx) => page(tx, tenantId, null, scope, options));
}

/** A community's posts. Hot by default. */
export async function listCommunityPosts(
  viewer: { userId: string } | null,
  tenantId: string,
  communityId: string,
  options: FeedOptions = {},
): Promise<PostPage> {
  return listPosts(viewer, tenantId, { kind: 'community', communityId }, options);
}

/** What is rising across the tenant right now, for a rail. */
export async function trendingPosts(
  viewer: { userId: string } | null,
  tenantId: string,
  limit = 5,
): Promise<PostView[]> {
  return (await listPosts(viewer, tenantId, { kind: 'all' }, { sort: 'rising', limit })).items;
}
