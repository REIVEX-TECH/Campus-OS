/** Human relative time (e.g. "3 hours ago") using the platform Intl API. */
export function relativeTime(iso: string, locale = 'en'): string {
  const deltaSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds)
      return rtf.format(Math.round(deltaSeconds / seconds), unit);
  }
  return rtf.format(deltaSeconds, 'second');
}
