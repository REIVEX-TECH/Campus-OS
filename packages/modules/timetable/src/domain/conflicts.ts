import { overlaps } from './time';

export interface ConflictEntry {
  id: string;
  teacherId: string | null;
  roomId: string | null;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
}

export interface Conflict {
  type: 'teacher' | 'room';
  resourceId: string;
  dayOfWeek: number;
  a: string;
  b: string;
}

/**
 * Detect double-bookings among a set of (current) entries: the same teacher or
 * the same room scheduled for overlapping times on the same day. Entries on
 * different days, or that merely abut, do not conflict.
 */
export function detectConflicts(entries: readonly ConflictEntry[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (!a || !b) continue;
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) continue;
      if (a.teacherId && b.teacherId && a.teacherId === b.teacherId) {
        conflicts.push({
          type: 'teacher',
          resourceId: a.teacherId,
          dayOfWeek: a.dayOfWeek,
          a: a.id,
          b: b.id,
        });
      }
      if (a.roomId && b.roomId && a.roomId === b.roomId) {
        conflicts.push({
          type: 'room',
          resourceId: a.roomId,
          dayOfWeek: a.dayOfWeek,
          a: a.id,
          b: b.id,
        });
      }
    }
  }
  return conflicts;
}
