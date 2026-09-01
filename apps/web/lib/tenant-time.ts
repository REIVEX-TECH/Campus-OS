const ISO_DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * The current weekday (ISO 1..7) and minutes-since-midnight in the tenant's
 * timezone. Weekly class slots are stored as local wall-clock, so "free now"
 * must compare against the tenant's local time, not the server's (CLAUDE.md §5).
 */
export function tenantNow(timeZone: string): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const dayOfWeek = ISO_DAY[get('weekday')] ?? 1;
  const hour = Number(get('hour')) % 24; // some runtimes emit "24" at midnight
  const minutes = hour * 60 + Number(get('minute') || '0');
  return { dayOfWeek, minutes };
}

/** Minutes-since-midnight to "HH:MM". */
export function toHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse "HH:MM" to minutes, or null if malformed. */
export function parseHHMM(value: string | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (h! > 23 || m! > 59) return null;
  return h! * 60 + m!;
}
