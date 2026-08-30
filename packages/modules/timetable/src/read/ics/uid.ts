import { createHash } from 'node:crypto';
import type { TimetableView } from '../types';

function sha(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/** Logical-slot identity: same section+course meeting at the same weekly time+kind. */
function slotKey(view: TimetableView): string {
  return [view.section.id, view.course.id, view.dayOfWeek, view.startsAt, view.kind].join('|');
}

/**
 * Stable per-entry UIDs. Two entries that share a logical slot (e.g. the same
 * class split across rooms) get the same base plus a deterministic suffix so
 * they never collide, and the values are stable across regenerations (they
 * depend only on each entry's own fields). Calendar clients update in place
 * rather than duplicating.
 */
export function computeUids(
  views: readonly TimetableView[],
  domain = 'campusos',
): Map<string, string> {
  const groups = new Map<string, TimetableView[]>();
  for (const view of views) {
    const key = slotKey(view);
    const group = groups.get(key) ?? [];
    group.push(view);
    groups.set(key, group);
  }

  const uids = new Map<string, string>();
  for (const [key, group] of groups) {
    const base = sha(key);
    if (group.length === 1) {
      const only = group[0];
      if (only) uids.set(only.entryId, `${base}@${domain}`);
      continue;
    }
    for (const view of group) {
      const suffix = sha(
        `${view.room?.id ?? ''}|${view.teacher?.id ?? ''}|${view.endsAt}|${view.entryId}`,
        8,
      );
      uids.set(view.entryId, `${base}-${suffix}@${domain}`);
    }
  }
  return uids;
}
