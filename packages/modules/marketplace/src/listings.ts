import { sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Reading marketplace listings. Browse and the listing page are tenant-scoped
 * reads (the RLS tenant policy), so they run in a tenant context. Pages are pages:
 * a keyset "more" cursor, never infinite scroll. The cursor encodes the active
 * sort's key plus the id, so paging is stable under each sort.
 */

export type ListingStatus = 'active' | 'reserved' | 'sold' | 'expired' | 'removed';
export type ListingSort = 'new' | 'price_asc' | 'price_desc';

export interface ListingSummary {
  id: string;
  title: string;
  pricePaisa: number;
  priceKind: string;
  category: string;
  condition: string;
  status: string;
  createdAt: Date;
  /** Object key of the first photo's thumbnail, or null. Build a URL with mediaUrl(). */
  thumbKey: string | null;
}

export interface ListingPhoto {
  storageKey: string;
  thumbKey: string;
  width: number | null;
  height: number | null;
}

export interface ListingDetail {
  id: string;
  title: string;
  description: string;
  pricePaisa: number;
  priceKind: string;
  category: string;
  condition: string;
  meetupPref: string | null;
  status: string;
  createdAt: Date;
  soldAt: Date | null;
  sellerId: string;
  sellerHandle: string | null;
  sellerAvatarSeed: string | null;
  photos: ListingPhoto[];
}

export interface BrowseFilters {
  category?: string;
  condition?: string;
  /** Inclusive price bounds, in paisa. */
  priceMinPaisa?: number;
  priceMaxPaisa?: number;
  /** Free-text match on title and description. */
  search?: string;
}

export const PAGE_SIZE = 24;

function encodeCursor(sortVal: string, id: string): string {
  return Buffer.from(`${sortVal}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { sortVal: string; id: string } | null {
  try {
    const [sortVal, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (sortVal === undefined || !id) return null;
    return { sortVal, id };
  } catch {
    return null;
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The sort's ORDER BY, keyset predicate, and how it reads the cursor value. */
function sortPlan(
  sort: ListingSort,
  cursor: { sortVal: string; id: string } | null,
): { order: SQL; keyset: SQL } {
  if (sort === 'price_asc') {
    return {
      order: sql`order by l.price_paisa asc, l.id asc`,
      keyset: cursor
        ? sql`and (l.price_paisa, l.id) > (${Number(cursor.sortVal)}::bigint, ${cursor.id}::uuid)`
        : sql``,
    };
  }
  if (sort === 'price_desc') {
    return {
      order: sql`order by l.price_paisa desc, l.id desc`,
      keyset: cursor
        ? sql`and (l.price_paisa, l.id) < (${Number(cursor.sortVal)}::bigint, ${cursor.id}::uuid)`
        : sql``,
    };
  }
  return {
    order: sql`order by l.created_at desc, l.id desc`,
    keyset: cursor
      ? sql`and (l.created_at, l.id) < (${cursor.sortVal}::timestamptz, ${cursor.id}::uuid)`
      : sql``,
  };
}

function cursorValueOf(sort: ListingSort, row: ListingSummary): string {
  return sort === 'new' ? row.createdAt.toISOString() : String(row.pricePaisa);
}

export async function listListings(
  tenantId: string,
  opts: {
    filters?: BrowseFilters;
    sort?: ListingSort;
    cursor?: string | null;
    /** Default browse shows only 'active'; 'sold' shows recently-sold too. */
    status?: 'active' | 'sold';
  } = {},
): Promise<{ items: ListingSummary[]; nextCursor: string | null }> {
  const filters = opts.filters ?? {};
  const sort = opts.sort ?? 'new';
  const status = opts.status ?? 'active';
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const plan = sortPlan(sort, cursor);
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select l.id, l.title, l.price_paisa, l.price_kind, l.category, l.condition, l.status,
               l.created_at,
               (select p.thumb_key from mkt_listing_photos p
                 where p.listing_id = l.id order by p.position asc limit 1) as thumb_key
        from mkt_listings l
        where l.tenant_id = ${tenantId}
          and l.deleted_at is null
          and l.status = ${status}
          ${filters.category ? sql`and l.category = ${filters.category}` : sql``}
          ${filters.condition ? sql`and l.condition = ${filters.condition}` : sql``}
          ${filters.priceMinPaisa !== undefined ? sql`and l.price_paisa >= ${filters.priceMinPaisa}` : sql``}
          ${filters.priceMaxPaisa !== undefined ? sql`and l.price_paisa <= ${filters.priceMaxPaisa}` : sql``}
          ${
            filters.search
              ? sql`and (l.title ilike ${'%' + filters.search + '%'} or l.description ilike ${'%' + filters.search + '%'})`
              : sql``
          }
          ${plan.keyset}
        ${plan.order}
        limit ${PAGE_SIZE + 1}
      `)),
    ] as Array<{
      id: string;
      title: string;
      price_paisa: string | number;
      price_kind: string;
      category: string;
      condition: string;
      status: string;
      created_at: string | Date;
      thumb_key: string | null;
    }>;
    const hasMore = rows.length > PAGE_SIZE;
    const items: ListingSummary[] = rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      title: r.title,
      pricePaisa: Number(r.price_paisa),
      priceKind: r.price_kind,
      category: r.category,
      condition: r.condition,
      status: r.status,
      createdAt: toDate(r.created_at),
      thumbKey: r.thumb_key,
    }));
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(cursorValueOf(sort, last), last.id) : null;
    return { items, nextCursor };
  });
}

export async function listingById(tenantId: string, id: string): Promise<ListingDetail | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select l.id, l.title, l.description, l.price_paisa, l.price_kind, l.category,
               l.condition, l.meetup_pref, l.status, l.created_at, l.sold_at, l.seller_id,
               p.handle as seller_handle, p.avatar_seed as seller_avatar_seed
        from mkt_listings l
        left join public_profiles p on p.user_id = l.seller_id
        where l.tenant_id = ${tenantId} and l.id = ${id}::uuid and l.deleted_at is null
        limit 1
      `)),
    ] as Array<{
      id: string;
      title: string;
      description: string;
      price_paisa: string | number;
      price_kind: string;
      category: string;
      condition: string;
      meetup_pref: string | null;
      status: string;
      created_at: string | Date;
      sold_at: string | Date | null;
      seller_id: string;
      seller_handle: string | null;
      seller_avatar_seed: string | null;
    }>;
    if (!row) return null;
    const photos = [
      ...(await tx.execute(sql`
        select storage_key, thumb_key, width, height
        from mkt_listing_photos
        where listing_id = ${id}::uuid
        order by position asc
      `)),
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
      pricePaisa: Number(row.price_paisa),
      priceKind: row.price_kind,
      category: row.category,
      condition: row.condition,
      meetupPref: row.meetup_pref,
      status: row.status,
      createdAt: toDate(row.created_at),
      soldAt: row.sold_at === null ? null : toDate(row.sold_at),
      sellerId: row.seller_id,
      sellerHandle: row.seller_handle,
      sellerAvatarSeed: row.seller_avatar_seed,
      photos: photos.map((p) => ({
        storageKey: p.storage_key,
        thumbKey: p.thumb_key,
        width: p.width,
        height: p.height,
      })),
    };
  });
}
