// Pure time helpers for the proportional timetable views (weekly grid, timeline).
// Client-safe (no imports). Wall-clock "HH:MM" / "HH:MM:SS" strings only.

/** Minutes since midnight for a wall-clock time string. */
export function minutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Trim a wall-clock time to "HH:MM" for display. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export interface Interval {
  startsAt: string;
  endsAt: string;
}

/** The earliest start and latest end across intervals, in minutes. Null if none.
 *  Used as a shared vertical scale so day columns and the timeline line up. */
export function bounds(items: Interval[]): { start: number; end: number } | null {
  if (items.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const it of items) {
    start = Math.min(start, minutes(it.startsAt));
    end = Math.max(end, minutes(it.endsAt));
  }
  return { start, end };
}

/**
 * Assign overlapping intervals to side-by-side lanes. Within a connected cluster
 * of overlaps every item gets a `lane` (0-based) and the cluster's `lanes` count,
 * so a block renders at width `1/lanes` offset by `lane` (non-overlapping items
 * get lane 0 of 1 lane, i.e. full width).
 */
export function assignLanes<T extends Interval>(
  items: T[],
): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => minutes(a.startsAt) - minutes(b.startsAt) || minutes(a.endsAt) - minutes(b.endsAt),
  );
  const out: Array<T & { lane: number; lanes: number }> = [];
  let cluster: Array<T & { lane: number }> = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = (): void => {
    const lanes = cluster.reduce((max, c) => Math.max(max, c.lane + 1), 1);
    for (const c of cluster) out.push({ ...c, lanes });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    const s = minutes(it.startsAt);
    const e = minutes(it.endsAt);
    if (cluster.length > 0 && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}
