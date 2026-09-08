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
