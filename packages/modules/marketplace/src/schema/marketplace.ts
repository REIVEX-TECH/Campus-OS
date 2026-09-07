import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The marketplace (goods) tables. Every one carries `tenant_id` and is under RLS
 * with the ordinary tenant policy plus FORCE (set in drizzle/0000), exactly like
 * Lost & Found. A listing is its seller's own content, so writes go through a
 * RESTRICTIVE own-row policy and a normal application insert (no definer);
 * moderation runs under the tenant policy plus an application permission check.
 *
 * References to people are plain uuids with SQL foreign keys; this module never
 * imports another module's schema. Prices are integer paisa (PKR), stored as
 * bigint so no amount overflows; the app enforces a per-listing cap.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const marketplaceListings = pgTable(
  'mkt_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Integer paisa (PKR). bigint so no amount overflows. */
    pricePaisa: bigint('price_paisa', { mode: 'number' }).notNull(),
    /** 'fixed' vs 'negotiable' price. */
    priceKind: text('price_kind').notNull().default('fixed'),
    category: text('category').notNull(),
    condition: text('condition').notNull(),
    meetupPref: text('meetup_pref'),
    /** 'active' | 'reserved' | 'sold' | 'expired' | 'removed'. */
    status: text('status').notNull().default('active'),
    reservedAt: tz('reserved_at'),
    soldAt: tz('sold_at'),
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    expiresAt: tz('expires_at'),
    expiryNotifiedAt: tz('expiry_notified_at'),
    editedAt: tz('edited_at'),
    deletedAt: tz('deleted_at'),
    createdAt,
  },
  (t) => [
    index('mkt_listings_browse_idx').on(t.tenantId, t.status, t.createdAt, t.id),
    index('mkt_listings_category_idx').on(t.tenantId, t.category, t.status, t.createdAt, t.id),
    index('mkt_listings_price_idx').on(t.tenantId, t.status, t.pricePaisa),
    index('mkt_listings_seller_idx').on(t.tenantId, t.sellerId, t.createdAt),
  ],
);

export const marketplaceListingPhotos = pgTable(
  'mkt_listing_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => marketplaceListings.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    byteSize: integer('byte_size'),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => [index('mkt_listing_photos_listing_idx').on(t.listingId, t.position)],
);

export type MarketplaceListing = typeof marketplaceListings.$inferSelect;
export type MarketplaceListingPhoto = typeof marketplaceListingPhotos.$inferSelect;
