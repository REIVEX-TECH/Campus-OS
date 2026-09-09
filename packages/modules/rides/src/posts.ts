import { sql } from 'drizzle-orm';
import { withActorInTenant, withTenant, type TenantTransaction } from '@campusos/db';

/**
 * Reading rides. Browse and the ride page are tenant-scoped reads (the RLS tenant
 * policy), so they run in a tenant context. Pages are pages: a keyset "more"
 * cursor on (depart_at, id), never infinite scroll. Seat requests, which are
 * private to the two parties, arrive with their own reader in a later PR.
 */

export type RideKind = 'offer' | 'request';
export type RideStatus = 'active' | 'full' | 'completed' | 'cancelled' | 'expired';

export interface RideSummary {
  id: string;
  kind: RideKind;
  originText: string;
  destText: string;
  departAt: Date;
  seatsTotal: number | null;
  seatsAvailable: number | null;
  womenOnly: boolean;
  status: string;
  authorHandle: string | null;
  authorAvatarSeed: string | null;
}

export interface RideDetail extends RideSummary {
  authorId: string;
  notes: string;
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  recurrence: { weekdays: number[]; time: string } | null;
  createdAt: Date;
}

export interface BrowseFilters {
  kind?: RideKind;
  /** Only rides the author flagged women-only. */
  womenOnly?: boolean;
  /** Free-text match on origin and destination. */
  search?: string;
  /** ISO date (YYYY-MM-DD) in the tenant timezone; only that day's rides. */
  onDate?: string;
}

export const PAGE_SIZE = 24;

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function encodeCursor(departAt: Date, id: string): string {
  return Buffer.from(`${departAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { departAt: string; id: string } | null {
  try {
    const [departAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!departAt || !id) return null;
    return { departAt, id };
  } catch {
    return null;
  }
}

// A `type` (not an interface) so it is assignable to the `Record<string, unknown>`
// that `tx.execute` returns and the row cast below is allowed.
type BrowseRow = {
  id: string;
  kind: string;
  origin_text: string;
  dest_text: string;
  depart_at: string | Date;
  seats_total: number | null;
  seats_available: number | null;
  women_only: boolean;
  status: string;
  author_handle: string | null;
  author_avatar_seed: string | null;
};

function toSummary(r: BrowseRow): RideSummary {
  return {
    id: r.id,
    kind: r.kind as RideKind,
    originText: r.origin_text,
    destText: r.dest_text,
    departAt: toDate(r.depart_at),
    seatsTotal: r.seats_total,
    seatsAvailable: r.seats_available,
    womenOnly: r.women_only,
    status: r.status,
    authorHandle: r.author_handle,
    authorAvatarSeed: r.author_avatar_seed,
  };
}

/**
 * Browse upcoming rides, newest departure first, a page at a time. Only `active`
 * and `full` rides appear (completed/cancelled/expired are out of default browse,
 * reachable by direct link for the parties). A blocked author's rides are hidden
 * from the caller both ways via `auth_blocked_between`.
 */
export async function browseRides(
  tenantId: string,
  opts: { filters?: BrowseFilters; cursor?: string | null; viewerId?: string | null } = {},
): Promise<{ rides: RideSummary[]; nextCursor: string | null }> {
  const filters = opts.filters ?? {};
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  // The block filter reads the viewer from app.user_id (auth_blocked_between), so
  // run in the viewer's actor context when there is one; otherwise a bare tenant read.
  const run = <T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> =>
    opts.viewerId ? withActorInTenant(opts.viewerId, tenantId, fn) : withTenant(tenantId, fn);
  return run(async (tx) => {
    const conds = [
      sql`r.tenant_id = ${tenantId}`,
      sql`r.status IN ('active', 'full')`,
      sql`r.depart_at >= now()`,
      // A ride auto-hidden by reports (0003) keeps its active status; keep it and
      // any moderator-removed ride out of browse.
      sql`r.hidden_at IS NULL`,
      sql`r.removed_at IS NULL`,
    ];
    if (filters.kind) conds.push(sql`r.kind = ${filters.kind}`);
    if (filters.womenOnly) conds.push(sql`r.women_only = true`);
    if (filters.search) {
      const like = `%${filters.search}%`;
      conds.push(sql`(r.origin_text ILIKE ${like} OR r.dest_text ILIKE ${like})`);
    }
    if (filters.onDate) {
      conds.push(sql`r.depart_at::date = ${filters.onDate}::date`);
    }
    if (opts.viewerId) {
      conds.push(sql`NOT auth_blocked_between(${tenantId}, r.author_id)`);
    }
    if (cursor) {
      conds.push(sql`(r.depart_at, r.id) > (${cursor.departAt}::timestamptz, ${cursor.id}::uuid)`);
    }
    const where = sql.join(conds, sql` AND `);
    const rows = [
      ...(await tx.execute(sql`
        select r.id, r.kind, r.origin_text, r.dest_text, r.depart_at,
               r.seats_total, r.seats_available, r.women_only, r.status,
               p.handle as author_handle, p.avatar_seed as author_avatar_seed
        from ride_posts r
        left join public_profiles p on p.user_id = r.author_id
        where ${where}
        order by r.depart_at asc, r.id asc
        limit ${PAGE_SIZE + 1}`)),
    ] as BrowseRow[];
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor =
      rows.length > PAGE_SIZE && last ? encodeCursor(toDate(last.depart_at), last.id) : null;
    return { rides: page.map(toSummary), nextCursor };
  });
}

/** One ride, with author handle. Returns null if not in this tenant. */
export async function ridePost(tenantId: string, id: string): Promise<RideDetail | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select r.id, r.kind, r.origin_text, r.dest_text, r.depart_at,
               r.seats_total, r.seats_available, r.women_only, r.status,
               r.author_id, r.notes, r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
               r.recurrence, r.created_at,
               p.handle as author_handle, p.avatar_seed as author_avatar_seed
        from ride_posts r
        left join public_profiles p on p.user_id = r.author_id
        where r.id = ${id}::uuid and r.tenant_id = ${tenantId}
        limit 1`)),
    ] as Array<
      BrowseRow & {
        author_id: string;
        notes: string;
        origin_lat: number | null;
        origin_lng: number | null;
        dest_lat: number | null;
        dest_lng: number | null;
        recurrence: { weekdays: number[]; time: string } | null;
        created_at: string | Date;
      }
    >;
    if (!row) return null;
    return {
      ...toSummary(row),
      authorId: row.author_id,
      notes: row.notes,
      originLat: row.origin_lat,
      originLng: row.origin_lng,
      destLat: row.dest_lat,
      destLng: row.dest_lng,
      recurrence: row.recurrence,
      createdAt: toDate(row.created_at),
    };
  });
}

/** A person's own rides in one tenant, any status, soonest departure first. */
export async function myRides(userId: string, tenantId: string): Promise<RideSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select r.id, r.kind, r.origin_text, r.dest_text, r.depart_at,
               r.seats_total, r.seats_available, r.women_only, r.status,
               p.handle as author_handle, p.avatar_seed as author_avatar_seed
        from ride_posts r
        left join public_profiles p on p.user_id = r.author_id
        where r.tenant_id = ${tenantId} and r.author_id = ${userId}::uuid
        order by r.depart_at desc, r.id desc
        limit 100`)),
    ] as BrowseRow[];
    return rows.map(toSummary);
  });
}
