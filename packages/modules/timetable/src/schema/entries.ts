import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { rooms } from '@campusos/db/schema';
import { academicTerms, courses, sections, teachers } from './catalog';
import { timetableEntryKind } from './enums';
import { tenantId } from './_shared';

/**
 * The versioned fact table. A slot is "current" when valid_to IS NULL. A change
 * closes the old row (sets valid_to) and inserts a new one; nothing is
 * hard-deleted. `content_hash` (see docs/versioning.md) makes ingestion
 * idempotent. Recurring slots are stored as local wall-clock time + ISO
 * day_of_week, interpreted through the tenant timezone (CLAUDE.md §5).
 */
export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').references(() => teachers.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    kind: timetableEntryKind('kind').notNull(),
    sourceRef: text('source_ref'),
    // The raw room string from the source (e.g. "Room 25 NB"), kept so a pending
    // room value can be counted and back-filled when an admin maps it. Excluded
    // from content_hash (which hashes room_id), so populating it does not churn.
    roomSource: text('room_source'),
    contentHash: text('content_hash').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tt_entries_section_idx').on(t.tenantId, t.sectionId, t.validTo),
    index('tt_entries_teacher_idx').on(t.tenantId, t.teacherId, t.validTo),
    index('tt_entries_room_day_idx').on(t.tenantId, t.roomId, t.dayOfWeek, t.validTo),
    index('tt_entries_term_idx').on(t.tenantId, t.termId, t.validTo),
    // At most one current entry per identical content, per tenant (idempotency).
    uniqueIndex('tt_entries_current_hash_uq')
      .on(t.tenantId, t.contentHash)
      .where(sql`${t.validTo} is null`),
    check('tt_entries_day_range', sql`${t.dayOfWeek} between 1 and 7`),
    check('tt_entries_time_order', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export type TimetableEntry = typeof timetableEntries.$inferSelect;
export type NewTimetableEntry = typeof timetableEntries.$inferInsert;
