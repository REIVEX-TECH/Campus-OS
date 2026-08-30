import { describe, expect, it } from 'vitest';
import { normalizeRecords, parseTimetable } from '../src/normalize';
import type { RawRecords } from '../src/fetch';

const timetableHtml = `
<table id="table-time">
  <tr><th>Time</th><th>8:00 - 8:30</th></tr>
  <tr><th>Monday</th>
    <td colspan=3><span class='style2'>Programming Fundamentals</span><br/><span>Room 25 NB</span><br/><span>Rabia Akhtar</span></td>
    <td colspan=1></td>
    <td colspan=2><span>Data Structures Lab</span><br/><span>Lab 1</span><br/><span>Ali</span></td>
  </tr>
  <tr><th>Tuesday</th>
    <td colspan=2><span>Calculus</span><br/><span></span><br/><span></span></td>
  </tr>
</table>`;

describe('parseTimetable', () => {
  it('parses classes with colspan-derived times and TBA nulls', () => {
    const slots = parseTimetable(timetableHtml);
    expect(slots).toContainEqual({
      day: 1,
      startsAt: '08:00',
      endsAt: '09:30',
      subject: 'Programming Fundamentals',
      room: 'Room 25 NB',
      teacher: 'Rabia Akhtar',
    });
    // a colspan=1 free cell (30m) then the lab: 10:00–11:00
    expect(slots.find((s) => s.subject === 'Data Structures Lab')).toMatchObject({
      startsAt: '10:00',
      endsAt: '11:00',
      room: 'Lab 1',
    });
    // empty room/teacher spans → null (rendered as TBA)
    expect(slots.find((s) => s.subject === 'Calculus')).toMatchObject({
      day: 2,
      room: null,
      teacher: null,
    });
  });
});

describe('normalizeRecords', () => {
  const raw: RawRecords = {
    semester: { value: '1st Semester Fa-2026 / Fa-2026', label: '1st Semester Fa-2026 / Fa-2026' },
    degree: { value: '1', label: 'BSCS' },
    sections: [{ value: '1', label: 'Sec A' }],
    timetables: [{ section: { value: '1', label: 'Sec A' }, html: timetableHtml }],
  };

  it('builds a batch and infers lab vs lecture from the title', () => {
    const batch = normalizeRecords(raw);
    expect(batch.programs[0]).toMatchObject({
      code: '1',
      name: 'BSCS',
      departmentCode: 'UNASSIGNED',
    });
    expect(batch.sections[0]?.name).toBe('Sec A');
    expect(batch.entries.find((e) => e.courseCode === 'data-structures-lab')?.kind).toBe('lab');
    expect(batch.entries.find((e) => e.courseCode === 'programming-fundamentals')?.kind).toBe(
      'lecture',
    );
    expect(batch.departments).toEqual([{ code: 'UNASSIGNED', name: 'Unassigned' }]);
  });
});
