/** Parse "HH:mm" or "HH:mm:ss" into minutes since midnight. */
export function toMinutes(time: string): number {
  const parts = time.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? '0');
  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    throw new Error(`invalid time: ${time}`);
  }
  return h * 60 + m;
}

/** Normalize to "HH:mm:ss" for stable hashing. */
export function normalizeTime(time: string): string {
  const [h = '0', m = '0', s = '0'] = time.split(':');
  const pad = (v: string): string => v.padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Two intervals overlap iff each starts before the other ends. Adjacency
 * (one ends exactly when the other starts) is NOT an overlap.
 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}
