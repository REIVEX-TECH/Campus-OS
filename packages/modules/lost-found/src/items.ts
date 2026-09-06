import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Reading Lost & Found items. Browse and the item page are tenant-scoped reads
 * (the RLS tenant policy), so they run in a tenant context; writing arrives in a
 * later PR. Pages are pages — a keyset "more" cursor, never infinite scroll.
 */

export type ItemKind = 'lost' | 'found';
export type ItemStatus = 'open' | 'resolved' | 'withdrawn' | 'removed' | 'expired';

export interface ItemSummary {
  id: string;
  kind: ItemKind;
  title: string;
  category: string;
  locationText: string | null;
  status: string;
  createdAt: Date;
  /** Object key of the first photo's thumbnail, or null. Build a URL with mediaUrl(). */
  thumbKey: string | null;
}

export interface ItemPhoto {
  storageKey: string;
  thumbKey: string;
  width: number | null;
  height: number | null;
}

export interface ItemDetail {
  id: string;
  kind: ItemKind;
  title: string;
  description: string;
  category: string;
  locationText: string | null;
  buildingId: string | null;
  buildingName: string | null;
  happenedOn: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  reporterId: string;
  reporterHandle: string | null;
  reporterAvatarSeed: string | null;
  photos: ItemPhoto[];
}

export interface BuildingOption {
  id: string;
  name: string;
}

/** The tenant's buildings, for the optional building field on the post form. */
export async function listBuildings(tenantId: string): Promise<BuildingOption[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, name from buildings
        where tenant_id = ${tenantId} and deleted_at is null
        order by name asc`)),
    ] as Array<{ id: string; name: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name }));
  });
}

export interface BrowseFilters {
  kind?: ItemKind;
  category?: string;
  /** Defaults to 'open'; expired items are excluded from default browse. */
  status?: 'open' | 'resolved';
}

export const PAGE_SIZE = 24;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
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

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function listItems(
  tenantId: string,
  opts: { filters?: BrowseFilters; cursor?: string | null } = {},
): Promise<{ items: ItemSummary[]; nextCursor: string | null }> {
  const filters = opts.filters ?? {};
  const status = filters.status ?? 'open';
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select i.id, i.kind, i.title, i.category, i.location_text, i.status, i.created_at,
               (select p.thumb_key from lf_item_photos p
                 where p.item_id = i.id and p.removed_at is null
                 order by p.position asc limit 1) as thumb_key
        from lf_items i
        where i.tenant_id = ${tenantId}
          and i.deleted_at is null
          and i.status = ${status}
          ${filters.kind ? sql`and i.kind = ${filters.kind}` : sql``}
          ${filters.category ? sql`and i.category = ${filters.category}` : sql``}
          ${cursor ? sql`and (i.created_at, i.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
        order by i.created_at desc, i.id desc
        limit ${PAGE_SIZE + 1}
      `)),
    ] as Array<{
      id: string;
      kind: string;
      title: string;
      category: string;
      location_text: string | null;
      status: string;
      created_at: string | Date;
      thumb_key: string | null;
    }>;
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const items: ItemSummary[] = page.map((r) => ({
      id: r.id,
      kind: r.kind as ItemKind,
      title: r.title,
      category: r.category,
      locationText: r.location_text,
      status: r.status,
      createdAt: toDate(r.created_at),
      thumbKey: r.thumb_key,
    }));
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  });
}

export async function itemById(tenantId: string, id: string): Promise<ItemDetail | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select i.id, i.kind, i.title, i.description, i.category, i.location_text,
               i.building_id, b.name as building_name, i.happened_on, i.status,
               i.created_at, i.resolved_at, i.reporter_id,
               p.handle as reporter_handle, p.avatar_seed as reporter_avatar_seed
        from lf_items i
        left join buildings b on b.id = i.building_id
        left join public_profiles p on p.user_id = i.reporter_id
        where i.tenant_id = ${tenantId} and i.id = ${id}::uuid and i.deleted_at is null
        limit 1
      `)),
    ] as Array<{
      id: string;
      kind: string;
      title: string;
      description: string;
      category: string;
      location_text: string | null;
      building_id: string | null;
      building_name: string | null;
      happened_on: string | null;
      status: string;
      created_at: string | Date;
      resolved_at: string | Date | null;
      reporter_id: string;
      reporter_handle: string | null;
      reporter_avatar_seed: string | null;
    }>;
    if (!row) return null;
    const photos = [
      ...(await tx.execute(sql`
        select storage_key, thumb_key, width, height
        from lf_item_photos
        where item_id = ${id}::uuid and removed_at is null
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
      kind: row.kind as ItemKind,
      title: row.title,
      description: row.description,
      category: row.category,
      locationText: row.location_text,
      buildingId: row.building_id,
      buildingName: row.building_name,
      happenedOn: row.happened_on,
      status: row.status,
      createdAt: toDate(row.created_at),
      resolvedAt: row.resolved_at === null ? null : toDate(row.resolved_at),
      reporterId: row.reporter_id,
      reporterHandle: row.reporter_handle,
      reporterAvatarSeed: row.reporter_avatar_seed,
      photos: photos.map((p) => ({
        storageKey: p.storage_key,
        thumbKey: p.thumb_key,
        width: p.width,
        height: p.height,
      })),
    };
  });
}
