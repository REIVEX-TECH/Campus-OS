import type {
  NormalizedBatch,
  NormalizedCourse,
  NormalizedEntry,
  NormalizedProgram,
  NormalizedSection,
  NormalizedTeacher,
  NormalizedTerm,
  TimetableKind,
  UnmappedValue,
} from '@campusos/core/ingestion';
import type { RawRecords } from './fetch';

const KIND_MAP: Record<string, TimetableKind> = {
  lecture: 'lecture',
  class: 'lecture',
  theory: 'lecture',
  lab: 'lab',
  practical: 'lab',
  tutorial: 'tutorial',
  exam: 'exam',
};

// LGU's public data has no department dimension; attach programs to a synthetic
// one so admins can reorganise later.
const DEFAULT_DEPARTMENT = { code: 'UNASSIGNED', name: 'Unassigned' };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapKind(type: string | undefined, unknowns: UnmappedValue[]): TimetableKind {
  if (!type) return 'lecture';
  const mapped = KIND_MAP[type.toLowerCase()];
  if (mapped) return mapped;
  unknowns.push({ kind: 'entry_kind', rawValue: type });
  return 'lecture';
}

/** Map raw LGU records onto our normalized shapes. Unknown values are recorded
 * (never dropped); the sink persists them as pending for admin review. */
export function normalizeRecords(raw: RawRecords): NormalizedBatch {
  const unknowns: UnmappedValue[] = [];
  const terms = new Map<string, NormalizedTerm>();
  const programs = new Map<string, NormalizedProgram>();
  const courses = new Map<string, NormalizedCourse>();
  const teachers = new Map<string, NormalizedTeacher>();
  const sections = new Map<string, NormalizedSection>();
  const entries: NormalizedEntry[] = [];

  for (const { combo, slots } of raw.timetables) {
    terms.set(combo.semester, { code: combo.semester, name: combo.semester });
    programs.set(combo.program, {
      code: combo.program,
      name: combo.program,
      departmentCode: DEFAULT_DEPARTMENT.code,
    });

    const sectionCode = `${combo.program}-${combo.semester}-${combo.section}`;
    sections.set(sectionCode, {
      code: sectionCode,
      name: combo.section,
      programCode: combo.program,
      termCode: combo.semester,
    });

    for (const slot of slots) {
      const courseCode = slot.courseCode ?? slugify(slot.course);
      courses.set(courseCode, { code: courseCode, title: slot.course });
      if (slot.teacher) teachers.set(slot.teacher, { name: slot.teacher });

      entries.push({
        termCode: combo.semester,
        sectionCode,
        courseCode,
        teacherName: slot.teacher ?? null,
        roomName: slot.room ?? null,
        dayOfWeek: slot.day,
        startsAt: slot.start,
        endsAt: slot.end,
        kind: mapKind(slot.type, unknowns),
        sourceRef: `${combo.semester}|${combo.program}|${combo.section}`,
      });
    }
  }

  return {
    terms: [...terms.values()],
    departments: [DEFAULT_DEPARTMENT],
    programs: [...programs.values()],
    courses: [...courses.values()],
    teachers: [...teachers.values()],
    sections: [...sections.values()],
    entries,
    unknowns,
  };
}
