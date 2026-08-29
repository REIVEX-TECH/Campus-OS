import type { TimetableEntryKind } from '../schema/enums';

/** A normalized, hashable timetable slot — the ingestion input unit. */
export interface TimetableEntryInput {
  termId: string;
  sectionId: string;
  courseId: string;
  teacherId: string | null;
  roomId: string | null;
  /** ISO-8601 day of week, 1 = Monday. */
  dayOfWeek: number;
  /** Local wall-clock time "HH:mm" or "HH:mm:ss". */
  startsAt: string;
  endsAt: string;
  kind: TimetableEntryKind;
  /** Provenance from the source system; excluded from the content hash. */
  sourceRef?: string | null;
}

export interface HashedEntry extends TimetableEntryInput {
  contentHash: string;
}

/** A currently-valid entry, reduced to what the diff needs. */
export interface CurrentEntryRef {
  id: string;
  contentHash: string;
}

export interface DiffPlan {
  toInsert: HashedEntry[];
  toCloseIds: string[];
  unchanged: number;
}
