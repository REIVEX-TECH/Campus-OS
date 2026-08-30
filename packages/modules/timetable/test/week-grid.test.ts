import { describe, expect, it } from 'vitest';
import { buildWeekGrid } from '../src/read/week-grid';
import type { TimetableView } from '../src/read/types';

function view(
  over: Partial<TimetableView> & {
    entryId: string;
    dayOfWeek: number;
    startsAt: string;
    endsAt: string;
  },
): TimetableView {
  return {
    kind: 'lecture',
    course: { id: 'c1', code: 'CS', title: 'CS' },
    teacher: null,
    room: null,
    section: { id: 's1', name: 'A', status: 'active' },
    validFrom: '2026-01-01T00:00:00.000Z',
    pending: false,
    ...over,
  };
}

describe('buildWeekGrid', () => {
  it('sorts day columns and time rows, and groups cells', () => {
    const grid = buildWeekGrid([
      view({ entryId: 'a', dayOfWeek: 3, startsAt: '11:00', endsAt: '12:00' }),
      view({ entryId: 'b', dayOfWeek: 1, startsAt: '09:00', endsAt: '10:30' }),
      view({ entryId: 'c', dayOfWeek: 1, startsAt: '09:00', endsAt: '10:30' }),
    ]);

    expect(grid.days).toEqual([1, 3]);
    expect(grid.rows.map((r) => r.startsAt)).toEqual(['09:00', '11:00']);
    expect(grid.rows[0]?.byDay[1]?.map((v) => v.entryId)).toEqual(['b', 'c']);
    expect(grid.rows[0]?.byDay[3]).toEqual([]);
  });

  it('handles an empty set', () => {
    expect(buildWeekGrid([])).toEqual({ days: [], rows: [] });
  });
});
