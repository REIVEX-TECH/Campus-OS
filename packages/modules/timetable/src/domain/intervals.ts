import { toMinutes } from './time';

/**
 * Interval arithmetic on wall-clock minutes, shared by everything that asks
 * "when is this busy" or "when is this free": the free-rooms query, the free
 * slots on a teacher or room profile, and the utilisation figures.
 *
 * It exists because two callers once answered the same question differently.
 * The room page listed a class in a room while the free-rooms page called the
 * room free in that very slot, because each computed occupancy its own way with
 * its own filters. One implementation here, consumed by all of them, is what
 * stops that recurring: they can only disagree by disagreeing with themselves.
 */

/** A half-open interval [start, end) in minutes since midnight. */
export interface Interval {
  start: number;
  end: number;
}

/** Anything with a wall-clock start and end and an ISO weekday. */
export interface Slot {
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
}

/**
 * Coalesce overlapping and touching intervals, sorted by start. Two classes
 * that overlap, or one that ends as the next begins, become one busy stretch,
 * so free-time arithmetic is not fooled into counting the overlap twice or
 * reporting a zero-length gap between them.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && it.start <= last.end) last.end = Math.max(last.end, it.end);
    else out.push({ ...it });
  }
  return out;
}

/**
 * The busy stretches on one weekday, merged, optionally clipped to a window.
 *
 * This is THE definition of "busy" for a day: every slot on that day, as
 * half-open intervals, merged. Callers that want a single entity's busy time
 * filter the slots to that entity first; callers that want "anything at all in
 * this room" pass every slot for the room.
 */
export function busyIntervals(
  slots: readonly Slot[],
  dayOfWeek: number,
  clip?: Interval,
): Interval[] {
  const raw = slots
    .filter((s) => s.dayOfWeek === dayOfWeek)
    .map((s) => ({ start: toMinutes(s.startsAt), end: toMinutes(s.endsAt) }))
    .map((i) =>
      clip ? { start: Math.max(clip.start, i.start), end: Math.min(clip.end, i.end) } : i,
    );
  return mergeIntervals(raw);
}

/**
 * Whether a window is busy at all: any busy interval overlaps it. Half-open,
 * so a class that ends exactly as the window starts, or starts exactly as it
 * ends, is not an overlap. This is the predicate the free-rooms page must use.
 */
export function isBusy(busy: readonly Interval[], window: Interval): boolean {
  return busy.some((b) => b.start < window.end && window.start < b.end);
}

/**
 * The unbooked stretches inside a window, given merged busy intervals. The
 * complement of `busyIntervals` within [open, close).
 */
export function freeGaps(busy: readonly Interval[], window: Interval): Interval[] {
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= window.start) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}

/** Total minutes covered by a set of intervals, merged first so overlap counts once. */
export function totalMinutes(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((n, i) => n + (i.end - i.start), 0);
}
