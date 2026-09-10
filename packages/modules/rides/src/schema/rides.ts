import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The Rides tables. Every one carries `tenant_id` and is under RLS (set in
 * drizzle/0000). References to people are plain uuids: the foreign keys exist in
 * SQL, but this module never imports another module's schema. A ride is its
 * author's own content, so writes go through a RESTRICTIVE own-row policy and a
 * normal application insert (the posts pattern). Seat requests, ratings and
 * reports, which cross users, arrive with their own tighter RLS in later
 * migrations.
 *
 * No gender is stored: `womenOnly` is a self-declared label + browse filter.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const ridePosts = pgTable(
  'ride_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** The person who posted. FK to users(id) in SQL. */
    authorId: uuid('author_id').notNull(),
    /** 'offer' (has a seat ledger) | 'request' (a want-ad, no ledger). */
    kind: text('kind').notNull(),
    originText: text('origin_text').notNull(),
    destText: text('dest_text').notNull(),
    /** Optional coordinates so the campus end can link to the campus-map module. */
    originLat: doublePrecision('origin_lat'),
    originLng: doublePrecision('origin_lng'),
    destLat: doublePrecision('dest_lat'),
    destLng: doublePrecision('dest_lng'),
    /** The concrete departure instant (UTC), created from tenant-local input. */
    departAt: tz('depart_at').notNull(),
    /** Offers only: the seat ledger. Null on a request. */
    seatsTotal: integer('seats_total'),
    seatsAvailable: integer('seats_available'),
    notes: text('notes').notNull().default(''),
    /** Author-set, self-declared, unverified label + browse filter. No gender stored. */
    womenOnly: boolean('women_only').notNull().default(false),
    /** 'active' | 'full' | 'completed' | 'cancelled' | 'expired' */
    status: text('status').notNull().default('active'),
    /** For a recurring offer: `{ weekdays: number[], time: "HH:MM" }` (wall-clock). */
    recurrence: jsonb('recurrence'),
    /** The recurring offer this occurrence was spawned from. FK (set null) in SQL. */
    recurrenceParentId: uuid('recurrence_parent_id'),
    cancelledAt: tz('cancelled_at'),
    completedAt: tz('completed_at'),
    editedAt: tz('edited_at'),
    /** Moderator removal (0003). */
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    /** Auto-hidden pending a moderator once open reports reach the threshold (0003). */
    hiddenAt: tz('hidden_at'),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('ride_posts_browse_idx').on(t.tenantId, t.status, t.departAt, t.id),
    index('ride_posts_author_idx').on(t.tenantId, t.authorId, t.createdAt),
    uniqueIndex('ride_posts_occurrence_uq').on(t.recurrenceParentId, t.departAt),
  ],
);

export type RidePostRow = typeof ridePosts.$inferSelect;

export const rideSeatRequests = pgTable(
  'ride_seat_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** The offer this seat is on. FK to ride_posts(id) cascade in SQL. */
    ridePostId: uuid('ride_post_id').notNull(),
    /** The person asking for a seat. FK to users(id) cascade in SQL. */
    passengerId: uuid('passenger_id').notNull(),
    seats: integer('seats').notNull().default(1),
    /** 'pending' | 'accepted' | 'declined' | 'cancelled' */
    status: text('status').notNull().default('pending'),
    /** The messages conversation the accept flow opens (a later PR). */
    conversationId: uuid('conversation_id'),
    createdAt,
    decidedAt: tz('decided_at'),
  },
  (t) => [
    index('ride_seat_requests_ride_idx').on(t.ridePostId, t.status, t.createdAt),
    index('ride_seat_requests_passenger_idx').on(t.tenantId, t.passengerId, t.createdAt),
  ],
);

export type RideSeatRequestRow = typeof rideSeatRequests.$inferSelect;

export const rideRatings = pgTable(
  'ride_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    ridePostId: uuid('ride_post_id').notNull(),
    raterId: uuid('rater_id').notNull(),
    rateeId: uuid('ratee_id').notNull(),
    /** 'of_driver' (a passenger rated the driver) | 'of_passenger' */
    direction: text('direction').notNull(),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    createdAt,
  },
  (t) => [
    uniqueIndex('ride_ratings_pairing_uq').on(t.ridePostId, t.raterId, t.rateeId),
    index('ride_ratings_ratee_idx').on(t.tenantId, t.rateeId, t.createdAt),
  ],
);

export type RideRatingRow = typeof rideRatings.$inferSelect;

export const rideReports = pgTable(
  'ride_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** 'ride_post' | 'user' */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    status: text('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: tz('resolved_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('ride_reports_one_per_reporter_uq').on(t.targetType, t.targetId, t.reporterId),
    index('ride_reports_queue_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

export type RideReportRow = typeof rideReports.$inferSelect;

export const rideShareTokens = pgTable(
  'ride_share_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    ridePostId: uuid('ride_post_id').notNull(),
    /** sha256 hex of the raw bearer token; the raw token lives only in the URL. */
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('ride_share_tokens_hash_uq').on(t.tokenHash),
    index('ride_share_tokens_ride_idx').on(t.tenantId, t.ridePostId),
  ],
);

export type RideShareTokenRow = typeof rideShareTokens.$inferSelect;
