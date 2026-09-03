/**
 * How a wall-clock time is shown.
 *
 * Storage never changes: weekly slots are local wall-clock "HH:MM" plus an ISO
 * weekday, and stay that way (CLAUDE.md, Time). This is presentation only, and
 * it is the ONE place a time becomes text, so the grid gutter, a class row, a
 * free-slot chip and the free-rooms summary cannot drift apart. The ICS feed and
 * JSON-LD are standards with their own formats and do not come through here.
 *
 * Which format is a tenant setting: a university in a 12 hour culture reads
 * "1:30 PM", another may want "13:30". Nothing here knows which tenant it is.
 */

export const TIME_FORMATS = ['12h', '24h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** Hours and minutes out of "HH:MM" or "HH:MM:SS". Throws on anything else. */
function parts(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':');
  const hour = Number(h);
  const minute = Number(m ?? '0');
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23) {
    throw new Error(`invalid time: ${time}`);
  }
  return { hour, minute };
}

/** "8:00 AM", "12:00 PM", "12:30 AM"; or "08:00", "13:30" in 24 hour mode. */
export function formatTime(time: string, format: TimeFormat): string {
  const { hour, minute } = parts(time);
  const mm = String(minute).padStart(2, '0');
  if (format === '24h') return `${String(hour).padStart(2, '0')}:${mm}`;
  const period = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${mm} ${period}`;
}

/**
 * A ruler label for a whole hour: "8 AM", "12 PM", "1 PM"; or "08:00" in 24 hour
 * mode. No minutes, because a gutter is read at a glance and every label there
 * is on the hour.
 */
export function formatHourLabel(hour: number, format: TimeFormat): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 24) throw new Error(`invalid hour: ${hour}`);
  const h = hour % 24;
  if (format === '24h') return `${String(h).padStart(2, '0')}:00`;
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

/**
 * Both ends of a slot, ready for the tenant's "{start} to {end}" string. Kept
 * as two strings rather than one so the i18n catalogue owns the word between.
 */
export function formatTimeRange(
  start: string,
  end: string,
  format: TimeFormat,
): { start: string; end: string } {
  return { start: formatTime(start, format), end: formatTime(end, format) };
}
