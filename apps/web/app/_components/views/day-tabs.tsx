import { Card } from '@campusos/ui';
import { ClassRow, type ViewProps } from './parts';
import { DaySelector } from './day-selector';
import { minutes } from './time-scale';

/** Tap a day, see that day's classes as a clean list. The phone-first view. */
export function DayTabs({
  views,
  base,
  locale,
  t,
  days,
  day,
  onDay,
}: ViewProps & { days: number[]; day: number; onDay: (day: number) => void }) {
  const dayViews = views
    .filter((v) => v.dayOfWeek === day)
    .sort((a, b) => minutes(a.startsAt) - minutes(b.startsAt));

  return (
    <div className="flex flex-col gap-4">
      <DaySelector days={days} selected={day} onSelect={onDay} locale={locale} t={t} />
      {dayViews.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {t('timetable.noClasses')}
        </Card>
      ) : (
        <Card className="p-5">
          <ul className="flex flex-col gap-5">
            {dayViews.map((v) => (
              <ClassRow key={v.entryId} view={v} base={base} locale={locale} t={t} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
