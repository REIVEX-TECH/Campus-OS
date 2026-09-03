import type { TeachingWindow, TimetableView } from '@campusos/module-timetable/read';
import {
  busyIntervals,
  freeGaps,
  toMinutes,
  totalMinutes,
} from '@campusos/module-timetable/domain';

/**
 * Read-only statistics derived from a class list that has already been fetched
 * and tenant-scoped. Nothing here queries or collects anything: every figure is
 * a projection of the timetable rows the page already has, so a teacher or room
 * profile costs no extra reads.
 *
 * Free slots and utilisation measure against the tenant's observed teaching
 * window (see `TeachingWindow`), so two teachers, or two rooms, are compared on
 * the same denominator rather than each against its own busiest day.
 */

export interface Slot {
  /** Local wall-clock "HH:MM". */
  startsAt: string;
  endsAt: string;
}

export interface DayFreeSlots {
  dayOfWeek: number;
  slots: Slot[];
  /** Free minutes on this day inside the teaching window. */
  freeMinutes: number;
}

export interface CourseTally {
  id: string;
  code: string;
  title: string;
  classes: number;
}

export interface TimetableStats {
  /** Weekly recurring classes. */
  classes: number;
  /** Total scheduled minutes in a week. */
  busyMinutes: number;
  /** ISO weekdays (1 = Monday) that carry at least one class, ascending. */
  days: number[];
  /** The day with the most scheduled minutes, or null when there are none. */
  busiestDay: number | null;
  courses: CourseTally[];
  /** Distinct sections taught / hosted. */
  sections: number;
  /** Share of the teaching window that is booked, 0..100, or null with no window. */
  utilisationPct: number | null;
  freeByDay: DayFreeSlots[];
}

function toHHMM(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The unbooked stretches of each teaching day, inside the window. A day the
 * entity never uses is reported as one full-window free slot, which is what a
 * student reading "when is this teacher free" expects.
 */
export function freeSlots(views: TimetableView[], window: TeachingWindow): DayFreeSlots[] {
  if (!window.startsAt || !window.endsAt || window.days.length === 0) return [];
  const open = toMinutes(window.startsAt);
  const close = toMinutes(window.endsAt);
  if (close <= open) return [];
  const frame = { start: open, end: close };

  // The same busy and free arithmetic the free-rooms query uses, so a room's
  // profile and the free-rooms page can never disagree about a slot.
  return window.days.map((dayOfWeek) => {
    const busy = busyIntervals(views, dayOfWeek, frame);
    const slots: Slot[] = freeGaps(busy, frame).map((g) => ({
      startsAt: toHHMM(g.start),
      endsAt: toHHMM(g.end),
    }));
    return { dayOfWeek, slots, freeMinutes: close - open - totalMinutes(busy) };
  });
}

/** Every figure a teacher or room profile shows, from the class list it already has. */
export function timetableStats(views: TimetableView[], window: TeachingWindow): TimetableStats {
  const byDayMinutes = new Map<number, number>();
  const courseMap = new Map<string, CourseTally>();
  const sectionIds = new Set<string>();
  let busyMinutes = 0;

  for (const v of views) {
    const span = Math.max(0, toMinutes(v.endsAt) - toMinutes(v.startsAt));
    busyMinutes += span;
    byDayMinutes.set(v.dayOfWeek, (byDayMinutes.get(v.dayOfWeek) ?? 0) + span);
    sectionIds.add(v.section.id);
    const tally = courseMap.get(v.course.id);
    if (tally) tally.classes += 1;
    else
      courseMap.set(v.course.id, {
        id: v.course.id,
        code: v.course.code,
        title: v.course.title,
        classes: 1,
      });
  }

  const days = [...byDayMinutes.keys()].sort((a, b) => a - b);
  let busiestDay: number | null = null;
  let best = -1;
  for (const [day, mins] of byDayMinutes) {
    if (mins > best) {
      best = mins;
      busiestDay = day;
    }
  }

  const open = window.startsAt ? toMinutes(window.startsAt) : null;
  const close = window.endsAt ? toMinutes(window.endsAt) : null;
  const capacity =
    open !== null && close !== null && close > open ? (close - open) * window.days.length : 0;

  return {
    classes: views.length,
    busyMinutes,
    days,
    busiestDay,
    courses: [...courseMap.values()].sort((a, b) => a.code.localeCompare(b.code, 'en')),
    sections: sectionIds.size,
    utilisationPct: capacity > 0 ? Math.round((busyMinutes / capacity) * 100) : null,
    freeByDay: freeSlots(views, window),
  };
}

/** "5h 30m" / "45m" from a minute count, for a compact stat tile. */
export function formatDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
