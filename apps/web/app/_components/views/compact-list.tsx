import { Card } from '@campusos/ui';
import { dayName } from '../../../lib/i18n';
import { ClassRow, type ViewProps } from './parts';
import { minutes } from './time-scale';

/** Day-grouped vertical list: one white card per weekday, classes as rows
 *  separated by spacing (no divider lines). The tightened, de-noised default. */
export function CompactList({ views, base, locale, timeFormat, t }: ViewProps) {
  const byDay = new Map<number, typeof views>();
  for (const v of views) {
    const list = byDay.get(v.dayOfWeek) ?? [];
    list.push(v);
    byDay.set(v.dayOfWeek, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => {
        const dayViews = (byDay.get(day) ?? []).sort(
          (a, b) => minutes(a.startsAt) - minutes(b.startsAt),
        );
        return (
          <section key={day} className="flex flex-col gap-2">
            <h3 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {dayName(locale, day)}
            </h3>
            <Card className="p-4">
              <ul className="flex flex-col gap-5">
                {dayViews.map((v) => (
                  <ClassRow
                    key={v.entryId}
                    view={v}
                    base={base}
                    locale={locale}
                    timeFormat={timeFormat}
                    t={t}
                  />
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
