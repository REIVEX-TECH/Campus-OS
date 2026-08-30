import { describe, expect, it } from 'vitest';
import { normalizeRecords } from '../src/normalize';
import type { RawRecords } from '../src/fetch';

const raw: RawRecords = {
  combos: [{ semester: 'Fall 2025', program: 'BSCS', section: 'A' }],
  timetables: [
    {
      combo: { semester: 'Fall 2025', program: 'BSCS', section: 'A' },
      slots: [
        {
          day: 1,
          start: '09:00',
          end: '10:30',
          course: 'Algorithms',
          courseCode: 'CS301',
          teacher: 'Dr. Sara',
          room: 'R-1',
          type: 'Lecture',
        },
        {
          day: 2,
          start: '11:00',
          end: '12:00',
          course: 'Unknown Kind Course',
          type: 'Workshop',
        },
      ],
    },
  ],
};

describe('normalizeRecords', () => {
  it('maps combos to terms/programs/sections and derives a section code', () => {
    const batch = normalizeRecords(raw);
    expect(batch.sections[0]?.code).toBe('BSCS-Fall 2025-A');
    expect(batch.sections[0]?.programCode).toBe('BSCS');
    expect(batch.sections[0]?.termCode).toBe('Fall 2025');
  });

  it('records an unknown entry kind and defaults it to lecture', () => {
    const batch = normalizeRecords(raw);
    expect(batch.unknowns).toContainEqual({ kind: 'entry_kind', rawValue: 'Workshop' });
    const workshopEntry = batch.entries.find((e) => e.courseCode === 'unknown-kind-course');
    expect(workshopEntry?.kind).toBe('lecture');
  });

  it('carries a source ref and nulls a missing teacher/room', () => {
    const batch = normalizeRecords(raw);
    const entry = batch.entries.find((e) => e.courseCode === 'unknown-kind-course');
    expect(entry?.teacherName).toBeNull();
    expect(entry?.roomName).toBeNull();
    expect(entry?.sourceRef).toBe('Fall 2025|BSCS|A');
  });
});
