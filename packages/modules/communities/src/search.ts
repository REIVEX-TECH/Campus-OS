import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';
import type { CommunitySummary } from './communities';
import { scopeWhere, selectPosts, viewerFilters } from './feed';
import { attachCrossposts, toPostView, type PostView } from './posts';
import { communities } from './schema/communities';
import { postsRead } from './schema/communities';

/**
 * Search within a tenant: posts by title and text, communities by name and
 * description. Postgres full text with the 'simple' dictionary and
 * websearch syntax ("quoted phrases", -excluded). Posts come through the
 * same view, scope and viewer filters as the feeds, so a search shows a
 * person exactly what their feeds would, ranked by match then by recency.
 */

export const MIN_QUERY = 2;

function tsquery(q: string) {
  return sql`websearch_to_tsquery('simple', ${q})`;
}

const postDocument = sql`to_tsvector('simple', coalesce(${postsRead.title}, '') || ' ' || coalesce(${postsRead.body}, ''))`;
const communityDocument = sql`to_tsvector('simple', ${communities.name} || ' ' || coalesce(${communities.description}, ''))`;

export function normaliseQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').slice(0, 200);
}

async function findPosts(
  tx: TenantTransaction,
  tenantId: string,
  viewer: { userId: string } | null,
  q: string,
  limit: number,
): Promise<PostView[]> {
  const query = tsquery(q);
  const rows = await selectPosts(tx, viewer)
    .where(
      and(
        eq(postsRead.tenantId, tenantId),
        // What the feeds show: public communities, plus the ones this person joined.
        or(
          scopeWhere(tx, tenantId, { kind: 'all' }, viewer),
          viewer ? scopeWhere(tx, tenantId, { kind: 'home' }, viewer) : sql`false`,
        ),
        isNull(postsRead.deletedAt),
        isNull(postsRead.removedAt),
        ...viewerFilters(viewer),
        sql`${postDocument} @@ ${query}`,
      ),
    )
    .orderBy(sql`ts_rank(${postDocument}, ${query}) desc`, desc(postsRead.createdAt))
    .limit(limit);
  return attachCrossposts(
    tx,
    rows.map((r) =>
      toPostView(
        r.post,
        r.handle,
        r.avatarSeed,
        { myVote: r.myVote, saved: r.saved !== null },
        { slug: r.communitySlug, name: r.communityName },
      ),
    ),
  );
}

/** Posts matching the words, as this viewer may see them. Empty below two characters. */
export async function searchPosts(
  viewer: { userId: string } | null,
  tenantId: string,
  rawQuery: string,
  limit = 20,
): Promise<PostView[]> {
  const q = normaliseQuery(rawQuery);
  if (q.length < MIN_QUERY) return [];
  return viewer
    ? withActorInTenant(viewer.userId, tenantId, (tx) => findPosts(tx, tenantId, viewer, q, limit))
    : withTenant(tenantId, (tx) => findPosts(tx, tenantId, null, q, limit));
}

/** Live, approved, public communities matching the words, best match first then biggest. */
export async function searchCommunities(
  tenantId: string,
  rawQuery: string,
  limit = 20,
): Promise<CommunitySummary[]> {
  const q = normaliseQuery(rawQuery);
  if (q.length < MIN_QUERY) return [];
  return withTenant(tenantId, async (tx) => {
    const query = tsquery(q);
    const rows = await tx
      .select()
      .from(communities)
      .where(
        and(
          eq(communities.tenantId, tenantId),
          eq(communities.approvalStatus, 'approved'),
          eq(communities.visibility, 'public'),
          isNull(communities.deletedAt),
          sql`${communityDocument} @@ ${query}`,
        ),
      )
      .orderBy(
        sql`ts_rank(${communityDocument}, ${query}) desc`,
        desc(communities.memberCount),
        asc(communities.name),
      )
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      iconSeed: row.iconSeed,
      bannerSeed: row.bannerSeed,
      visibility: row.visibility,
      allowAnonymous: row.allowAnonymous,
      allowedKinds: row.allowedKinds,
      approvalStatus: row.approvalStatus,
      memberCount: row.memberCount,
      createdAt: row.createdAt,
      archivedAt: row.archivedAt,
    }));
  });
}
