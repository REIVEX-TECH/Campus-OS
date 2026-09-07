import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isVerifiedMember } from './access';
import {
  marketplaceListingPhotos,
  marketplaceListings,
  marketplaceSaved,
} from './schema/marketplace';
import type { MarketplaceSettings } from './manifest';
import { hasContactInfo, listingInputSchema, type ListingInput } from './input';

/** Selling is verified-only, and capped per person to slow abuse. */
export type ListingRefusal =
  'not_verified' | 'invalid' | 'rate_limited' | 'not_found' | 'contact_info';
export type PhotoRefusal = 'not_found' | 'too_many_photos';

/** Listings one person may create in a rolling hour. */
const LISTINGS_PER_HOUR = 10;

/**
 * Create a goods listing. Verified members only; the price is capped by settings;
 * a phone number or WhatsApp handle in the title or description is refused so
 * contact stays in the messages module (where blocking and reporting live).
 */
export async function createListing(
  actor: { userId: string },
  tenantId: string,
  input: ListingInput,
  settings: MarketplaceSettings,
): Promise<Result<{ id: string }, ListingRefusal>> {
  const parsed = listingInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const data = parsed.data;
  if (!settings.categories.includes(data.category)) return err('invalid');
  if (data.pricePaisa > settings.maxPricePaisa) return err('invalid');
  if (hasContactInfo(data.title) || hasContactInfo(data.description)) return err('contact_info');
  const expiresAt = new Date(Date.now() + settings.expiryDays * 24 * 60 * 60 * 1000);
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from mkt_listings
        where tenant_id = ${tenantId} and seller_id = ${actor.userId}::uuid
          and created_at > now() - interval '1 hour'`)),
    ] as { n: number }[];
    if ((recent?.n ?? 0) >= LISTINGS_PER_HOUR) return err('rate_limited');
    const [row] = await tx
      .insert(marketplaceListings)
      .values({
        tenantId,
        sellerId: actor.userId,
        title: data.title,
        description: data.description ?? '',
        pricePaisa: data.pricePaisa,
        priceKind: data.priceKind,
        category: data.category,
        condition: data.condition,
        meetupPref: data.meetupPref ?? null,
        expiresAt,
      })
      .returning({ id: marketplaceListings.id });
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
 * Record a stored photo against a listing the caller sells. Ownership is enforced
 * both here (the listing must be the caller's) and by the RESTRICTIVE insert
 * policy. The count cap comes from the tenant's settings.
 */
export async function addListingPhoto(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
  photo: PhotoInput,
  maxPhotos: number,
): Promise<Result<{ position: number }, PhotoRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [listing] = [
      ...(await tx.execute(sql`
        select id from mkt_listings
        where id = ${listingId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and deleted_at is null
        limit 1`)),
    ];
    if (!listing) return err('not_found');
    const [counted] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from mkt_listing_photos where listing_id = ${listingId}::uuid`)),
    ] as { n: number }[];
    const position = counted?.n ?? 0;
    if (position >= maxPhotos) return err('too_many_photos');
    await tx.insert(marketplaceListingPhotos).values({
      tenantId,
      listingId,
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

/** How a listing's status may change by the seller. */
export type ListingLifecycleRefusal = 'not_found' | 'not_allowed' | 'invalid';

/** Which current statuses each target may be reached from (seller transitions). */
const ALLOWED_FROM: Record<'active' | 'reserved' | 'sold', string[]> = {
  reserved: ['active'],
  sold: ['active', 'reserved'],
  active: ['reserved', 'sold', 'expired'], // relist
};

/**
 * The seller sets their own listing to reserved, sold, or back to active (relist).
 * Stamps reserved_at / sold_at on entry and clears them when it returns to active.
 * Only the seller's own, non-deleted listing moves, and only along an allowed edge.
 */
export async function setListingStatus(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
  next: 'active' | 'reserved' | 'sold',
): Promise<Result<{ changed: boolean }, ListingLifecycleRefusal>> {
  const from = ALLOWED_FROM[next];
  if (!from) return err('invalid');
  const reservedAt =
    next === 'reserved' ? sql`now()` : next === 'active' ? sql`null` : sql`reserved_at`;
  const soldAt = next === 'sold' ? sql`now()` : next === 'active' ? sql`null` : sql`sold_at`;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_listings
           set status = ${next}, reserved_at = ${reservedAt}, sold_at = ${soldAt}, edited_at = now()
        where id = ${listingId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and deleted_at is null
          and status in (${sql.join(
            from.map((s) => sql`${s}`),
            sql`, `,
          )})
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}

/**
 * The seller takes their own listing down for good: soft-delete the row (so it
 * leaves browse and the detail page) and delete its photo rows, returning the
 * storage keys for the caller to remove the files.
 */
export async function deleteListing(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
): Promise<Result<{ changed: boolean; photoKeys: string[] }, ListingLifecycleRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_listings set deleted_at = now(), edited_at = now()
        where id = ${listingId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and deleted_at is null
        returning id`)),
    ];
    if (rows.length === 0) return ok({ changed: false, photoKeys: [] });
    return ok({ changed: true, photoKeys: await deleteListingPhotoRows(tx, listingId) });
  });
}

/** Push one's own active listing's expiry out by another full window (one-tap). */
export async function extendListing(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
  settings: MarketplaceSettings,
): Promise<Result<{ changed: boolean }, ListingLifecycleRefusal>> {
  const days = Math.max(1, Math.floor(settings.expiryDays));
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_listings
           set expires_at = now() + (${days}::int * interval '1 day'),
               expiry_notified_at = null, edited_at = now()
        where id = ${listingId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and status = 'active' and deleted_at is null
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}

/** Delete a listing's photo rows and return their storage keys (full + thumb) so
 *  the caller can remove the files. Used when a listing is removed/withdrawn. */
export async function deleteListingPhotoRows(
  tx: TenantTransaction,
  listingId: string,
): Promise<string[]> {
  const rows = [
    ...(await tx.execute(sql`
      delete from mkt_listing_photos where listing_id = ${listingId}::uuid
      returning storage_key, thumb_key`)),
  ] as { storage_key: string; thumb_key: string }[];
  return rows.flatMap((r) => [r.storage_key, r.thumb_key]).filter((k): k is string => Boolean(k));
}

/** Save (bookmark) a listing for the actor. Idempotent (one row per pair). The
 *  own-row RLS policy enforces user_id = the caller; we set it explicitly too. */
export async function saveListing(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
): Promise<Result<{ ok: true }, 'not_found'>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    await tx
      .insert(marketplaceSaved)
      .values({ tenantId, userId: actor.userId, listingId })
      .onConflictDoNothing({ target: [marketplaceSaved.userId, marketplaceSaved.listingId] });
    return ok({ ok: true });
  });
}

/** Remove a saved listing for the actor. Idempotent. */
export async function unsaveListing(
  actor: { userId: string },
  tenantId: string,
  listingId: string,
): Promise<Result<{ ok: true }, 'not_found'>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    await tx.execute(sql`
      delete from mkt_saved
      where user_id = ${actor.userId}::uuid and listing_id = ${listingId}::uuid`);
    return ok({ ok: true });
  });
}
