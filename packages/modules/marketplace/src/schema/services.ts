import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The marketplace services (gigs) tables. A gig is a service a verified member
 * offers, priced through one to three packages (Fiverr-style tiers). Ordering,
 * the order state machine and reviews live in the orders migration (0004); this
 * file is the catalog: what is on offer.
 *
 * Like goods, every table carries `tenant_id` and is under RLS with the tenant
 * policy plus FORCE (drizzle/0003). A gig and its packages are the seller's own
 * content: writes go through a RESTRICTIVE own-row policy and a normal application
 * insert (no definer). References to people are plain uuids; this module never
 * imports another module's schema. Prices are integer paisa (PKR), stored as
 * bigint so no amount overflows; the app enforces a per-package cap.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const marketplaceGigs = pgTable(
  'mkt_gigs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    /** 'active' | 'paused' | 'removed'. */
    status: text('status').notNull().default('active'),
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    editedAt: tz('edited_at'),
    deletedAt: tz('deleted_at'),
    createdAt,
  },
  (t) => [
    index('mkt_gigs_browse_idx').on(t.tenantId, t.status, t.createdAt, t.id),
    index('mkt_gigs_category_idx').on(t.tenantId, t.category, t.status, t.createdAt, t.id),
    index('mkt_gigs_seller_idx').on(t.tenantId, t.sellerId, t.createdAt),
  ],
);

export const marketplaceGigPackages = pgTable(
  'mkt_gig_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => marketplaceGigs.id, { onDelete: 'cascade' }),
    /** 'basic' | 'standard' | 'premium'. One row per tier, per gig. */
    tier: text('tier').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Integer paisa (PKR). bigint so no amount overflows. */
    pricePaisa: bigint('price_paisa', { mode: 'number' }).notNull(),
    /** Promised turnaround, whole days. */
    deliveryDays: integer('delivery_days').notNull(),
    /** Revisions included with this package. */
    revisions: integer('revisions').notNull().default(0),
    position: integer('position').notNull().default(0),
    createdAt,
  },
  (t) => [
    uniqueIndex('mkt_gig_packages_tier_uq').on(t.gigId, t.tier),
    index('mkt_gig_packages_gig_idx').on(t.gigId, t.position),
  ],
);

export const marketplaceGigPhotos = pgTable(
  'mkt_gig_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => marketplaceGigs.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    byteSize: integer('byte_size'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mkt_gig_photos_gig_idx').on(t.gigId, t.position)],
);

export type MarketplaceGig = typeof marketplaceGigs.$inferSelect;
export type MarketplaceGigPackage = typeof marketplaceGigPackages.$inferSelect;
export type MarketplaceGigPhoto = typeof marketplaceGigPhotos.$inferSelect;
