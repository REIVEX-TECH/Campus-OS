import { describe, expect, it } from 'vitest';
import { toICS } from '../src/read/ics/generate';
import { computeUids } from '../src/read/ics/uid';
import { tzInfo } from '../src/read/ics/vtimezone';
import type { TimetableView } from '../src/read/types';

const base = (over: Partial<TimetableView> = {}): TimetableView => ({
  entryId: 'e0',
  dayOfWeek: 1,
  startsAt: '09:00',
  endsAt: '10:30',
  kind: 'lecture',
  course: { id: 'c1', code: 'CS201', title: 'Data Structures' },
  teacher: null,
  room: null,
  section: { id: 's1', name: 'A', status: 'active' },
  validFrom: '2026-01-01T00:00:00.000Z',
  pending: false,
  ...over,
});

describe('vtimezone guard', () => {
  it('supports Asia/Karachi', () => {
    expect(tzInfo('Asia/Karachi').offset).toBe('+0500');
  });
  it('throws loudly on a DST / unknown zone', () => {
    expect(() => tzInfo('Europe/London')).toThrow(/Unsupported timezone/);
  });
});

describe('computeUids', () => {
  it('gives same-slot entries distinct, stable UIDs', () => {
    const a = base({ entryId: 'a', room: { id: 'r1', name: 'R1' } });
    const b = base({ entryId: 'b', room: { id: 'r2', name: 'R2' } });
    const first = computeUids([a, b]);
    const second = computeUids([a, b]);
    expect(first.get('a')).not.toBe(first.get('b'));
    expect(first.get('a')).toBe(second.get('a'));
  });

  it('gives a lone entry the bare base UID', () => {
    const uids = computeUids([base({ entryId: 'x' })]);
    expect(uids.get('x')).toMatch(/@campusos$/);
  });
});

describe('toICS', () => {
  const views = [base({ entryId: 'e1', teacher: { id: 't1', name: 'Dr X', status: 'pending' } })];

  it('emits VTIMEZONE/TZID, weekly RRULE, a UID, and TBA for a null room', () => {
    const ics = toICS(views, { tzid: 'Asia/Karachi', calendarName: 'LGU', anchor: '2025-09-01' });
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:Asia/Karachi');
    expect(ics).toContain('DTSTART;TZID=Asia/Karachi:20250901T090000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(ics).toMatch(/UID:[0-9a-f]+@campusos/);
    expect(ics).toContain('LOCATION:TBA');
    expect(ics).not.toContain('UNTIL=');
  });

  it('adds RRULE UNTIL when a term end is provided', () => {
    const ics = toICS(views, {
      tzid: 'Asia/Karachi',
      calendarName: 'LGU',
      anchor: '2025-09-01',
      termEnd: '2025-12-20',
    });
    expect(ics).toMatch(/UNTIL=\d{8}T\d{6}Z/);
  });

  it('throws on an unsupported timezone rather than emitting wrong data', () => {
    expect(() =>
      toICS(views, { tzid: 'Europe/London', calendarName: 'x', anchor: '2025-09-01' }),
    ).toThrow();
  });
});
