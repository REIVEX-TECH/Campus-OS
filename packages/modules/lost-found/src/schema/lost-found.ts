import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The Lost & Found tables. Every one carries `tenant_id` and is under RLS with
 * the ordinary tenant policy plus FORCE (set in drizzle/0000).
 *
 * References to people and to buildings are plain uuids here: the foreign keys
 * exist in SQL (drizzle/0000), but this module never imports another module's
 * schema. An item is its reporter's own content, so item and photo writes go
 * through a RESTRICTIVE own-row policy and a normal application insert — no
 * definer (the communities `posts` pattern). Claims, which cross users, arrive
 * with their own tighter RLS in a later migration.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const lostFoundItems = pgTable(
  'lf_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** The person who reported the item. FK to users(id) in SQL. */
    reporterId: uuid('reporter_id').notNull(),
    /** 'lost' | 'found' */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** One of the tenant's configured categories (validated in the service). */
    category: text('category').notNull(),
    /** Free-text location, e.g. "near the library entrance". */
    locationText: text('location_text'),
    /** Optional building from the shared buildings table. FK (set null) in SQL. */
    buildingId: uuid('building_id'),
    /** When it was lost or found (date only). */
    happenedOn: date('happened_on'),
    /** 'open' | 'resolved' | 'withdrawn' | 'removed' | 'expired' */
    status: text('status').notNull().default('open'),
    /** The claim that resolved it. FK added with the claims table. */
    resolvedViaClaimId: uuid('resolved_via_claim_id'),
    resolvedAt: tz('resolved_at'),
    /** Auto-expiry of an open item; nulled when resolved/withdrawn. */
    expiresAt: tz('expires_at'),
    expiryNotifiedAt: tz('expiry_notified_at'),
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    editedAt: tz('edited_at'),
    deletedAt: tz('deleted_at'),
    createdAt,
  },
  (t) => [
    index('lf_items_browse_idx').on(t.tenantId, t.status, t.createdAt, t.id),
    index('lf_items_category_idx').on(t.tenantId, t.category, t.status, t.createdAt, t.id),
    index('lf_items_reporter_idx').on(t.tenantId, t.reporterId, t.createdAt),
  ],
);

export const lostFoundItemPhotos = pgTable(
  'lf_item_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** FK to lf_items(id) cascade in SQL. */
    itemId: uuid('item_id').notNull(),
    /** Object-store keys for the display image and its thumbnail. */
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    byteSize: integer('byte_size'),
    position: integer('position').notNull().default(0),
    removedAt: tz('removed_at'),
    createdAt,
  },
  (t) => [index('lf_item_photos_item_idx').on(t.itemId, t.position)],
);

/**
 * A claim on an item: the claimant asserting it is theirs (lost) or theirs to
 * collect (found), and the private thread with the reporter. Unlike items,
 * claims are NOT tenant-wide readable — RLS confines them to the claimant, the
 * item's reporter, and moderators (drizzle/0001). One open claim per person per
 * item (a partial unique index).
 */
export const lostFoundClaims = pgTable(
  'lf_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    itemId: uuid('item_id').notNull(),
    claimantId: uuid('claimant_id').notNull(),
    message: text('message').notNull(),
    /** 'pending' | 'approved' | 'denied' | 'withdrawn' */
    status: text('status').notNull().default('pending'),
    decidedAt: tz('decided_at'),
    deletedAt: tz('deleted_at'),
    createdAt,
  },
  (t) => [index('lf_claims_item_idx').on(t.tenantId, t.itemId, t.status, t.createdAt)],
);

export const lostFoundClaimMessages = pgTable(
  'lf_claim_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    claimId: uuid('claim_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    body: text('body').notNull(),
    createdAt,
  },
  (t) => [index('lf_claim_messages_claim_idx').on(t.claimId, t.createdAt)],
);

/**
 * A report on an item or a claim. Own-row for the reporter (RLS); moderators
 * read the queue and resolve through definers gated on lostfound.moderate
 * (drizzle/0002).
 */
export const lostFoundReports = pgTable(
  'lf_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** 'lf_item' | 'lf_claim' */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    /** 'open' | 'resolved' */
    status: text('status').notNull().default('open'),
    /** 'removed' | 'dismissed' */
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: tz('resolved_at'),
    createdAt,
  },
  (t) => [index('lf_reports_queue_idx').on(t.tenantId, t.status, t.createdAt)],
);

export type LostFoundItem = typeof lostFoundItems.$inferSelect;
export type LostFoundItemPhoto = typeof lostFoundItemPhotos.$inferSelect;
export type LostFoundClaim = typeof lostFoundClaims.$inferSelect;
export type LostFoundClaimMessage = typeof lostFoundClaimMessages.$inferSelect;
export type LostFoundReport = typeof lostFoundReports.$inferSelect;
