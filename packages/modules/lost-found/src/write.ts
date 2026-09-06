import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isVerifiedMember } from './access';
import { lostFoundItemPhotos, lostFoundItems } from './schema/lost-found';
import type { LostFoundSettings } from './manifest';
import type { ItemKind, ItemSummary } from './items';
import { itemInputSchema, type ItemInput } from './input';

/** Posting is verified-only, and capped per person to slow abuse. */
export type ItemRefusal = 'not_verified' | 'invalid' | 'rate_limited' | 'not_found';
export type PhotoRefusal = 'not_found' | 'too_many_photos';

/** Items one person may create in a rolling hour. */
const ITEMS_PER_HOUR = 10;

export async function createItem(
  actor: { userId: string },
  tenantId: string,
  input: ItemInput,
  settings: LostFoundSettings,
): Promise<Result<{ id: string }, ItemRefusal>> {
  const parsed = itemInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const data = parsed.data;
  if (!settings.categories.includes(data.category)) return err('invalid');
  const expiresAt = new Date(Date.now() + settings.expiryDays * 24 * 60 * 60 * 1000);
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from lf_items
        where tenant_id = ${tenantId} and reporter_id = ${actor.userId}::uuid
          and created_at > now() - interval '1 hour'`)),
    ] as { n: number }[];
    if ((recent?.n ?? 0) >= ITEMS_PER_HOUR) return err('rate_limited');
    const [row] = await tx
      .insert(lostFoundItems)
      .values({
        tenantId,
        reporterId: actor.userId,
        kind: data.kind,
        title: data.title,
        description: data.description ?? '',
        category: data.category,
        locationText: data.locationText ?? null,
        buildingId: data.buildingId ?? null,
        happenedOn: data.happenedOn ?? null,
        expiresAt,
      })
      .returning({ id: lostFoundItems.id });
    return ok({ id: row!.id });
  });
}

export interface PhotoInput {
  storageKey: string;
  thumbKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
}

/**
 * Record a stored photo against an item the caller reported. Ownership is
 * enforced both here (the item must be the caller's) and by the RESTRICTIVE
 * insert policy. The count cap comes from the tenant's settings.
 */
export async function addItemPhoto(
  actor: { userId: string },
  tenantId: string,
  itemId: string,
  photo: PhotoInput,
  maxPhotos: number,
): Promise<Result<{ position: number }, PhotoRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [item] = [
      ...(await tx.execute(sql`
        select id from lf_items
        where id = ${itemId}::uuid and tenant_id = ${tenantId}
          and reporter_id = ${actor.userId}::uuid and deleted_at is null
        limit 1`)),
    ];
    if (!item) return err('not_found');
    const [counted] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from lf_item_photos
        where item_id = ${itemId}::uuid and removed_at is null`)),
    ] as { n: number }[];
    const position = counted?.n ?? 0;
    if (position >= maxPhotos) return err('too_many_photos');
    await tx.insert(lostFoundItemPhotos).values({
      tenantId,
      itemId,
      storageKey: photo.storageKey,
      thumbKey: photo.thumbKey,
      contentType: photo.contentType,
      width: photo.width,
      height: photo.height,
      byteSize: photo.byteSize,
      position,
    });
    return ok({ position });
  });
}

/** Withdraw one's own open item. Idempotent-ish: only an open item changes. */
export async function withdrawItem(
  actor: { userId: string },
  tenantId: string,
  itemId: string,
): Promise<Result<{ changed: boolean }, ItemRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update lf_items set status = 'withdrawn', edited_at = now()
        where id = ${itemId}::uuid and tenant_id = ${tenantId}
          and reporter_id = ${actor.userId}::uuid and status = 'open'
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}

/** A person's own items in one tenant, any status, newest first. */
export async function myItems(userId: string, tenantId: string): Promise<ItemSummary[]> {
  return withActorInTenant(userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select i.id, i.kind, i.title, i.category, i.location_text, i.status, i.created_at,
               (select p.thumb_key from lf_item_photos p
                 where p.item_id = i.id and p.removed_at is null
                 order by p.position asc limit 1) as thumb_key
        from lf_items i
        where i.tenant_id = ${tenantId} and i.reporter_id = ${userId}::uuid and i.deleted_at is null
        order by i.created_at desc, i.id desc
        limit 100`)),
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
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as ItemKind,
      title: r.title,
      category: r.category,
      locationText: r.location_text,
      status: r.status,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      thumbKey: r.thumb_key,
    }));
  });
}
