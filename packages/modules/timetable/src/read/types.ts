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
