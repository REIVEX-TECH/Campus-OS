import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Reading gigs. Browse and the gig page are tenant-scoped reads (the RLS tenant
 * policy). A gig card shows the cheapest package's price ("from Rs X"); the gig
 * page shows every package. Pages use a keyset "more" cursor, newest first.
 */

export interface GigSummary {
  id: string;
  title: string;
  category: string;
  status: string;
  createdAt: Date;
  /** Cheapest package price, in paisa, or null if a gig somehow has no package. */
  fromPricePaisa: number | null;
  sellerId: string;
  sellerHandle: string | null;
  sellerAvatarSeed: string | null;
}

export interface GigPackage {
  id: string;
  tier: string;
  title: string;
  description: string;
  pricePaisa: number;
  deliveryDays: number;
  revisions: number;
  position: number;
}

export interface GigPortfolioPhoto {
  storageKey: string;
  thumbKey: string;
  width: number | null;
  height: number | null;
}

export interface GigDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  createdAt: Date;
  sellerId: string;
  sellerHandle: string | null;
  sellerAvatarSeed: string | null;
  packages: GigPackage[];
  /** Portfolio sample images, in order. */
  photos: GigPortfolioPhoto[];
  /** Public rating summary across the seller's completed, reviewed orders on this gig. */
  ratingCount: number;
  ratingAvg: number | null;
}

export const GIG_PAGE_SIZE = 24;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

interface GigRow {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string | Date;
  from_price_paisa: string | number | null;
  seller_id: string;
  seller_handle: string | null;
  seller_avatar_seed: string | null;
}

function rowToSummary(r: GigRow): GigSummary {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    createdAt: toDate(r.created_at),
    fromPricePaisa: r.from_price_paisa === null ? null : Number(r.from_price_paisa),
    sellerId: r.seller_id,
    sellerHandle: r.seller_handle,
    sellerAvatarSeed: r.seller_avatar_seed,
  };
}

export async function listGigs(
  tenantId: string,
  opts: { category?: string; search?: string; cursor?: string | null } = {},
): Promise<{ items: GigSummary[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select g.id, g.title, g.category, g.status, g.created_at, g.seller_id,
               (select min(pk.price_paisa) from mkt_gig_packages pk where pk.gig_id = g.id)
                 as from_price_paisa,
               p.handle as seller_handle, p.avatar_seed as seller_avatar_seed
        from mkt_gigs g
        left join public_profiles p on p.user_id = g.seller_id
        where g.tenant_id = ${tenantId}
          and g.deleted_at is null
          and g.status = 'active'
          ${opts.category ? sql`and g.category = ${opts.category}` : sql``}
          ${
            opts.search
              ? sql`and (g.title ilike ${'%' + opts.search + '%'} or g.description ilike ${'%' + opts.search + '%'})`
              : sql``
          }
          ${cursor ? sql`and (g.created_at, g.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
        order by g.created_at desc, g.id desc
        limit ${GIG_PAGE_SIZE + 1}`)),
    ] as unknown as GigRow[];
    const hasMore = rows.length > GIG_PAGE_SIZE;
    const items = rows.slice(0, GIG_PAGE_SIZE).map(rowToSummary);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null;
    return { items, nextCursor };
  });
}

export async function gigById(tenantId: string, id: string): Promise<GigDetail | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select g.id, g.title, g.description, g.category, g.status, g.created_at, g.seller_id,
               p.handle as seller_handle, p.avatar_seed as seller_avatar_seed,
               (select count(*)::int from mkt_reviews rv where rv.gig_id = g.id) as rating_count,
               (select avg(rv.rating)::float from mkt_reviews rv where rv.gig_id = g.id)
                 as rating_avg
        from mkt_gigs g
        left join public_profiles p on p.user_id = g.seller_id
        where g.id = ${id}::uuid and g.tenant_id = ${tenantId} and g.deleted_at is null
        limit 1`)),
    ] as Array<{
      id: string;
      title: string;
      description: string;
      category: string;
      status: string;
      created_at: string | Date;
      seller_id: string;
      seller_handle: string | null;
      seller_avatar_seed: string | null;
      rating_count: number;
      rating_avg: number | null;
    }>;
    if (!row) return null;
    const pkgs = [
      ...(await tx.execute(sql`
        select id, tier, title, description, price_paisa, delivery_days, revisions, position
        from mkt_gig_packages where gig_id = ${id}::uuid order by position asc, price_paisa asc`)),
    ] as Array<{
      id: string;
      tier: string;
      title: string;
      description: string;
      price_paisa: string | number;
      delivery_days: number;
      revisions: number;
      position: number;
    }>;
    const photos = [
      ...(await tx.execute(sql`
        select storage_key, thumb_key, width, height
        from mkt_gig_photos where gig_id = ${id}::uuid order by position asc`)),
    ] as Array<{
      storage_key: string;
      thumb_key: string;
      width: number | null;
      height: number | null;
    }>;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      status: row.status,
      createdAt: toDate(row.created_at),
      sellerId: row.seller_id,
      sellerHandle: row.seller_handle,
      sellerAvatarSeed: row.seller_avatar_seed,
      photos: photos.map((p) => ({
        storageKey: p.storage_key,
        thumbKey: p.thumb_key,
        width: p.width,
        height: p.height,
      })),
      packages: pkgs.map((p) => ({
        id: p.id,
        tier: p.tier,
        title: p.title,
        description: p.description,
        pricePaisa: Number(p.price_paisa),
        deliveryDays: p.delivery_days,
        revisions: p.revisions,
        position: p.position,
      })),
      ratingCount: Number(row.rating_count ?? 0),
      ratingAvg: row.rating_avg === null ? null : Number(row.rating_avg),
    };
  });
}

/** A seller's own gigs (any status but deleted), newest first, for their dashboard. */
export async function myGigs(userId: string, tenantId: string): Promise<GigSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select g.id, g.title, g.category, g.status, g.created_at, g.seller_id,
               (select min(pk.price_paisa) from mkt_gig_packages pk where pk.gig_id = g.id)
                 as from_price_paisa,
               p.handle as seller_handle, p.avatar_seed as seller_avatar_seed
        from mkt_gigs g
        left join public_profiles p on p.user_id = g.seller_id
        where g.tenant_id = ${tenantId} and g.seller_id = ${userId}::uuid and g.deleted_at is null
        order by g.created_at desc, g.id desc
        limit 100`)),
    ] as unknown as GigRow[];
    return rows.map(rowToSummary);
  });
}
