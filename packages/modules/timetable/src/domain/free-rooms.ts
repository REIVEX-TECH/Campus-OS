import { overlaps } from './time';

export interface TimeWindow {
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
}

export interface OccupiedSlot {
  roomId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
}

/**
 * Given all candidate room ids and the occupied slots, return the rooms that
 * are free for the whole query window (same day, overlapping time).
 */
export function freeRooms(
  roomIds: readonly string[],
  occupied: readonly OccupiedSlot[],
  window: TimeWindow,
): string[] {
  const busy = new Set(
    occupied
      .filter(
        (slot) =>
          slot.dayOfWeek === window.dayOfWeek &&
          overlaps(slot.startsAt, slot.endsAt, window.startsAt, window.endsAt),
      )
      .map((slot) => slot.roomId),
  );
  return roomIds.filter((id) => !busy.has(id));
}
