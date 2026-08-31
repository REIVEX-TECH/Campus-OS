import { parse } from 'node-html-parser';
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
import { parsedSlotSchema, type ParsedSlot } from './schemas';

const DAY_TO_ISO: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const DEFAULT_DEPARTMENT = { code: 'UNASSIGNED', name: 'Unassigned' };
const SLOT_MINUTES = 30;
const DAY_START_MIN = 8 * 60; // the timetable grid starts at 08:00

const pad = (n: number): string => String(n).padStart(2, '0');
const toHHMM = (min: number): string => `${pad(Math.trunc(min / 60))}:${pad(min % 60)}`;
// Each real class cell carries its own "HH:MM - HH:MM" span; prefer it over the
// colspan-derived time (robust to a missing/mis-sized free cell in the grid).
const TIME_RE = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;
const slugify = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

// Inference: the portal timetable carries no explicit kind, so treat any title
// containing "lab" (case-insensitive) as a lab, everything else as a lecture.
const kindFor = (title: string): TimetableKind => (/lab/i.test(title) ? 'lab' : 'lecture');

/** Parse a section timetable (#table-time) into validated slots. Times are
 * derived from 08:00 with each `colspan` a 30-minute session. */
export function parseTimetable(html: string): ParsedSlot[] {
  const table = parse(html).querySelector('#table-time');
  if (!table) return [];

  const rows = table.querySelectorAll('tr');
  const slots: ParsedSlot[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    // skip the header row
    const row = rows[i];
    if (!row) continue;
    const day = DAY_TO_ISO[(row.querySelector('th')?.text ?? '').trim().toLowerCase()];
    if (!day) continue;

    let cursor = DAY_START_MIN;
    for (const td of row.querySelectorAll('td')) {
      const colspan = Number.parseInt(td.getAttribute('colspan') ?? '1', 10) || 1;
      const cellStart = cursor;
      cursor += SLOT_MINUTES * colspan;
      const spans = td.querySelectorAll('span');
      const subject = (spans[0]?.text ?? '').trim();
      if (!subject) continue; // free slot ("X" / "All slots are free"): no spans

      // spans: [0]=subject, [1]=room, [2]=teacher, then a section label and an
      // explicit "HH:MM - HH:MM" time span. Prefer that time; else colspan math.
      let startsAt = toHHMM(cellStart);
      let endsAt = toHHMM(cursor);
      for (const span of spans) {
        const m = TIME_RE.exec(span.text);
        if (m) {
          startsAt = `${pad(Number(m[1]))}:${m[2]}`;
          endsAt = `${pad(Number(m[3]))}:${m[4]}`;
          break;
        }
      }

      const parsed = parsedSlotSchema.safeParse({
        day,
        startsAt,
        endsAt,
        subject,
        room: (spans[1]?.text ?? '').trim() || null,
        teacher: (spans[2]?.text ?? '').trim() || null,
      });
      if (parsed.success) slots.push(parsed.data);
    }
  }
  return slots;
}

/** Map crawled portal records (all semesters/degrees/sections) onto a batch. */
export function normalizeRecords(raw: RawRecords): NormalizedBatch {
  const terms = new Map<string, NormalizedTerm>();
  const programs = new Map<string, NormalizedProgram>();
  const courses = new Map<string, NormalizedCourse>();
  const teachers = new Map<string, NormalizedTeacher>();
  const sections: NormalizedSection[] = [];
  const entries: NormalizedEntry[] = [];

  for (const { semester, degree, section, html } of raw.sections) {
    terms.set(semester.value, { code: semester.value, name: semester.label || semester.value });
    programs.set(degree.value, {
      code: degree.value,
      name: degree.label || degree.value,
      departmentCode: DEFAULT_DEPARTMENT.code,
    });

    const sectionCode = `${degree.value}::${semester.value}::${section.value}`;
    sections.push({
      code: sectionCode,
      name: section.label || section.value,
      programCode: degree.value,
      termCode: semester.value,
    });

    for (const slot of parseTimetable(html)) {
      const courseCode = slugify(slot.subject);
      courses.set(courseCode, { code: courseCode, title: slot.subject });
      if (slot.teacher) teachers.set(slot.teacher, { name: slot.teacher });
      entries.push({
        termCode: semester.value,
        sectionCode,
        courseCode,
        teacherName: slot.teacher,
        roomName: slot.room,
        dayOfWeek: slot.day,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        kind: kindFor(slot.subject),
        sourceRef: `${semester.value}|${degree.value}|${section.value}`,
      });
    }
  }

  // Anomalous fetches become unmapped records for admin review (never dropped).
  const unknowns: UnmappedValue[] = raw.anomalies.map((a) => ({
    kind: a.stage === 'degrees' ? 'program' : 'section',
    rawValue: [a.semester, a.degree, a.section].filter(Boolean).join('|') || a.stage,
  }));

  return {
    terms: [...terms.values()],
    departments: [DEFAULT_DEPARTMENT],
    programs: [...programs.values()],
    courses: [...courses.values()],
    teachers: [...teachers.values()],
    sections,
    entries,
    unknowns,
  };
}
