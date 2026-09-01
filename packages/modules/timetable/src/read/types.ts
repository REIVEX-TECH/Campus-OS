import type { TimetableEntryKind } from '../schema/enums';

export type RecordStatus = 'active' | 'pending';

export interface CourseRef {
  id: string;
  code: string;
  title: string;
}

export interface TeacherRef {
  id: string;
  name: string;
  status: RecordStatus;
}

export interface RoomRef {
  id: string;
  name: string;
}

export interface SectionRef {
  id: string;
  name: string;
  status: RecordStatus;
}

/** An enriched, display-ready timetable entry (names resolved, statuses attached). */
export interface TimetableView {
  entryId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  kind: TimetableEntryKind;
  course: CourseRef;
  teacher: TeacherRef | null;
  room: RoomRef | null;
  section: SectionRef;
  /** ISO instant of this version's validity start (used for ICS SEQUENCE). */
  validFrom: string;
  /** True when the section or teacher is auto-imported and pending review. */
  pending: boolean;
}

export interface TermSummary {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
  startsOn: string | null;
  endsOn: string | null;
}

export interface ProgramSummary {
  id: string;
  code: string;
  name: string;
}

export interface SectionSummary {
  id: string;
  name: string;
  status: RecordStatus;
  semester: number | null;
  termId: string;
  program: ProgramSummary;
}

export interface TeacherSummary {
  id: string;
  name: string;
  status: RecordStatus;
}

export interface RoomSummary {
  id: string;
  name: string;
}

/** Latest successful ingestion for a tenant, for the "Last updated" line. */
export interface Freshness {
  lastSuccessfulAt: string | null;
  source: string | null;
}

/**
 * Read-only aggregate counts over a tenant's existing data, for the admin
 * analytics panel. Nothing new is collected: these are counts of rows that
 * already exist. "Current" means the live version of a timetable entry
 * (`valid_to is null`); totals exclude soft-deleted dimension rows.
 */
export interface TimetableAnalytics {
  totals: {
    terms: number;
    programs: number;
    sections: number;
    courses: number;
    teachers: number;
    rooms: number;
    /** Current (live) timetable entries. */
    entries: number;
  };
  /** Current entries grouped by kind, every kind present, descending by count. */
  entriesByKind: { kind: TimetableEntryKind; count: number }[];
  /** Current entries per ISO weekday (1 = Monday .. 7 = Sunday), 1..7 always present. */
  entriesByDay: { dayOfWeek: number; count: number }[];
  /** How complete current entries are (a TBA teacher or room lowers coverage). */
  coverage: { entries: number; withTeacher: number; withRoom: number };
  /** Auto-imported rows still pending review (honesty over hiding). */
  pending: { teachers: number; sections: number };
}
