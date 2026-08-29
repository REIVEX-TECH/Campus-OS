import { pgEnum } from 'drizzle-orm/pg-core';

export const timetableEntryKind = pgEnum('timetable_entry_kind', [
  'lecture',
  'lab',
  'tutorial',
  'exam',
]);

export const ingestionStatus = pgEnum('ingestion_status', [
  'running',
  'success',
  'failed',
  'partial',
]);

export const subscriptionTarget = pgEnum('subscription_target', ['section', 'teacher', 'room']);

/** Dimension rows created from unmapped source values start as `pending`. */
export const recordStatus = pgEnum('record_status', ['active', 'pending']);

export const unmappedStatus = pgEnum('unmapped_status', ['pending', 'resolved', 'ignored']);

export type TimetableEntryKind = (typeof timetableEntryKind.enumValues)[number];
