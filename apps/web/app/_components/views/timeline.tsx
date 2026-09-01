import { Card } from '@campusos/ui';
import { ClassBlock, type ViewProps } from './parts';
import { DaySelector } from './day-selector';
import { assignLanes, bounds, minutes } from './time-scale';

const HOUR_PX = 68;

/**
 * One day on a proportional vertical time axis: blocks are placed and sized by
 * time, so gaps read as empty space and overlaps split into side-by-side lanes.
 * A taller scale than the weekly grid, focused on the shape of a single day.
 */
export function Timeline({
  views,
  base,
  locale,
  t,
  days,
  day,
  onDay,
}: ViewProps & { days: number[]; day: number; onDay: (day: number) => void }) {
  const dayViews = views.filter((v) => v.dayOfWeek === day);
  const b = bounds(dayViews);
  const startHour = b ? Math.floor(b.start / 60) : 8;
  const endHour = b ? Math.ceil(b.end / 60) : 9;
  const axisStart = startHour * 60;
  const height = (endHour - startHour) * HOUR_PX;
  const pxPerMin = HOUR_PX / 60;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const laid = assignLanes(dayViews);

  return (
    <div className="flex flex-col gap-4">
      <DaySelector days={days} selected={day} onSelect={onDay} locale={locale} t={t} />
      {dayViews.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {t('timetable.noClasses')}
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex">
            <div className="relative w-12 shrink-0" style={{ height }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 text-[11px] tabular-nums text-muted-foreground"
                  style={{ top: (h - startHour) * HOUR_PX - 6 }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            <div
              className="relative flex-1"
              style={{
                height,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX}px)`,
              }}
            >
              {laid.map((v) => (
                <ClassBlock
                  key={v.entryId}
                  view={v}
                  base={base}
                  locale={locale}
                  t={t}
                  style={{
                    top: (minutes(v.startsAt) - axisStart) * pxPerMin,
                    height: (minutes(v.endsAt) - minutes(v.startsAt)) * pxPerMin - 2,
                    left: `${(v.lane / v.lanes) * 100}%`,
                    width: `calc(${100 / v.lanes}% - 2px)`,
                  }}
                />
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
