import { describe, expect, it } from 'vitest';
import type { TeachingWindow, TimetableView } from '@campusos/module-timetable/read';
import { formatDuration, freeSlots, timetableStats } from '@/lib/timetable-stats';

const WINDOW: TeachingWindow = { startsAt: '08:00', endsAt: '17:00', days: [1, 2] };

function entry(over: Partial<TimetableView> & { startsAt: string; endsAt: string }): TimetableView {
  return {
    entryId: `${over.startsAt}-${over.dayOfWeek ?? 1}-${over.endsAt}`,
    dayOfWeek: 1,
    kind: 'lecture',
    course: { id: 'c1', code: 'CS101', title: 'Intro' },
    teacher: null,
    room: null,
    section: { id: 's1', name: 'A', status: 'active' },
    validFrom: '2026-01-01T00:00:00.000Z',
    pending: false,
    ...over,
  } as TimetableView;
}

describe('timetableStats', () => {
  it('counts classes, minutes, days and courses', () => {
    const s = timetableStats(
      [
        entry({ startsAt: '09:00', endsAt: '10:00', dayOfWeek: 1 }),
        entry({ startsAt: '11:00', endsAt: '12:30', dayOfWeek: 2 }),
        entry({
          startsAt: '13:00',
          endsAt: '14:00',
          dayOfWeek: 2,
          course: { id: 'c2', code: 'CS102', title: 'Data' },
        }),
      ],
      WINDOW,
    );
    expect(s.classes).toBe(3);
    expect(s.busyMinutes).toBe(60 + 90 + 60);
    expect(s.days).toEqual([1, 2]);
    expect(s.busiestDay).toBe(2);
    expect(s.courses.map((c) => c.code)).toEqual(['CS101', 'CS102']);
    expect(s.sections).toBe(1);
  });

  it('reports utilisation against the shared teaching window', () => {
    // One 9h day booked solid out of a 2 x 9h window is 50%.
    const s = timetableStats([entry({ startsAt: '08:00', endsAt: '17:00', dayOfWeek: 1 })], WINDOW);
    expect(s.utilisationPct).toBe(50);
  });

  it('has no utilisation when the tenant has no window yet', () => {
    const s = timetableStats([], { startsAt: null, endsAt: null, days: [] });
    expect(s.utilisationPct).toBeNull();
    expect(s.freeByDay).toEqual([]);
  });
});

describe('freeSlots', () => {
  it('finds the gaps around classes inside the window', () => {
    const slots = freeSlots(
      [
        entry({ startsAt: '09:00', endsAt: '10:00', dayOfWeek: 1 }),
        entry({ startsAt: '12:00', endsAt: '13:00', dayOfWeek: 1 }),
      ],
      { startsAt: '08:00', endsAt: '17:00', days: [1] },
    );
    expect(slots[0]!.slots).toEqual([
      { startsAt: '08:00', endsAt: '09:00' },
      { startsAt: '10:00', endsAt: '12:00' },
      { startsAt: '13:00', endsAt: '17:00' },
    ]);
    expect(slots[0]!.freeMinutes).toBe(9 * 60 - 120);
  });

  it('merges overlapping classes so a gap is not invented between them', () => {
    const slots = freeSlots(
      [
        entry({ startsAt: '09:00', endsAt: '11:00', dayOfWeek: 1 }),
        entry({ startsAt: '10:00', endsAt: '12:00', dayOfWeek: 1 }),
      ],
      { startsAt: '09:00', endsAt: '13:00', days: [1] },
    );
    expect(slots[0]!.slots).toEqual([{ startsAt: '12:00', endsAt: '13:00' }]);
  });

  it('treats an unused day as free for the whole window', () => {
    const slots = freeSlots([entry({ startsAt: '09:00', endsAt: '10:00', dayOfWeek: 1 })], WINDOW);
    const tuesday = slots.find((d) => d.dayOfWeek === 2)!;
    expect(tuesday.slots).toEqual([{ startsAt: '08:00', endsAt: '17:00' }]);
    expect(tuesday.freeMinutes).toBe(9 * 60);
  });
});

describe('formatDuration', () => {
  it('reads compactly', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(330)).toBe('5h 30m');
  });
});
