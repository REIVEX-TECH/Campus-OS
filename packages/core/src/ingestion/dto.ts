/** The canonical normalized shapes an adapter emits. These are the contract
 * between adapters and the timetable module's persistence sink. */

export type TimetableKind = 'lecture' | 'lab' | 'tutorial' | 'exam';

export interface NormalizedTerm {
  code: string;
  name: string;
}

export interface NormalizedDepartment {
  code: string;
  name: string;
}

export interface NormalizedProgram {
  code: string;
  name: string;
  departmentCode: string;
}

export interface NormalizedCourse {
  code: string;
  title: string;
  departmentCode?: string | null;
}

export interface NormalizedTeacher {
  name: string;
  employeeCode?: string | null;
}

export interface NormalizedSection {
  code: string;
  name: string;
  programCode: string;
  termCode: string;
  semester?: number | null;
}

export interface NormalizedEntry {
  termCode: string;
  sectionCode: string;
  courseCode: string;
  teacherName?: string | null;
  roomName?: string | null;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  kind: TimetableKind;
  sourceRef?: string | null;
}

export type UnmappedKind =
  'term' | 'program' | 'section' | 'course' | 'teacher' | 'room' | 'entry_kind';

export interface UnmappedValue {
  kind: UnmappedKind;
  rawValue: string;
  normalizedGuess?: string | null;
}

export interface NormalizedBatch {
  terms: NormalizedTerm[];
  departments: NormalizedDepartment[];
  programs: NormalizedProgram[];
  courses: NormalizedCourse[];
  teachers: NormalizedTeacher[];
  sections: NormalizedSection[];
  entries: NormalizedEntry[];
  unknowns: UnmappedValue[];
}

export interface IngestionStats {
  inserted: number;
  closed: number;
  unchanged: number;
  unknowns: number;
}
