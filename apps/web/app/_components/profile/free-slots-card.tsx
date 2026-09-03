import type { DayFreeSlots } from '@/lib/timetable-stats';
import { formatDuration } from '@/lib/timetable-stats';
import { formatTime, type TimeFormat } from '@campusos/core/time';
import { dayName, type Translate } from '@/lib/i18n';

/**
 * When this teacher or room is free, day by day, within the campus teaching
 * window. Derived from the same class list the timetable below shows, so the two
 * can never disagree. A day with nothing scheduled reads as free for the whole
 * window, which is what someone scanning for a slot expects.
 */
export function FreeSlotsCard({
  freeByDay,
  window,
  locale,
  timeFormat,
  t,
}: {
  freeByDay: DayFreeSlots[];
  window: { startsAt: string | null; endsAt: string | null };
  locale: string;
  timeFormat: TimeFormat;
  t: Translate;
}) {
  if (freeByDay.length === 0 || !window.startsAt || !window.endsAt) return null;

  return (
    <section className="ios-card flex min-w-0 flex-col gap-3 rounded-2xl p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{t('profile.freeSlots')}</h2>
        <p className="text-xs text-muted-foreground">
          {t('profile.freeSlotsIntro', {
            start: formatTime(window.startsAt, timeFormat),
            end: formatTime(window.endsAt, timeFormat),
          })}
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {freeByDay.map((d) => (
          <li key={d.dayOfWeek} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <span className="w-24 shrink-0 text-sm font-medium">
              {dayName(locale, d.dayOfWeek)}
            </span>
            {d.slots.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t('profile.noFree')}</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {d.slots.map((s) => (
                  <span
                    key={`${s.startsAt}-${s.endsAt}`}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                  >
                    {t('timetable.timeRange', {
                      start: formatTime(s.startsAt, timeFormat),
                      end: formatTime(s.endsAt, timeFormat),
                    })}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {formatDuration(d.freeMinutes)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
