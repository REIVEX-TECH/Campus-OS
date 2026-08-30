import type { TimetableView } from './types';

export interface WeekGridRow {
  startsAt: string;
  endsAt: string;
  byDay: Record<number, TimetableView[]>;
}

export interface WeekGrid {
  days: number[];
  rows: WeekGridRow[];
}

/**
 * Arrange views into an accessible grid: sorted distinct days as columns, sorted
 * distinct (start,end) windows as rows, each cell listing the views for that
 * day+window. Pure — unit-tested and reused by the ICS/UI layers.
 */
export function buildWeekGrid(views: readonly TimetableView[]): WeekGrid {
  const days = [...new Set(views.map((v) => v.dayOfWeek))].sort((a, b) => a - b);
  const windowKeys = [...new Set(views.map((v) => `${v.startsAt}|${v.endsAt}`))].sort();

  const rows: WeekGridRow[] = windowKeys.map((key) => {
    const [startsAt = '', endsAt = ''] = key.split('|');
    const byDay: Record<number, TimetableView[]> = {};
    for (const day of days) {
      byDay[day] = views.filter(
        (v) => v.startsAt === startsAt && v.endsAt === endsAt && v.dayOfWeek === day,
      );
    }
    return { startsAt, endsAt, byDay };
  });

  return { days, rows };
}
