import { dayName, dayShort } from '../../../lib/i18n';
import { ClassBlock, type ViewProps } from './parts';
import { assignLanes, bounds, minutes } from './time-scale';

const HOUR_PX = 56;

/**
 * Classic calendar: weekday columns, a left time gutter, class blocks placed and
 * sized by time (overlaps split into side-by-side lanes). The hour lines are a
 * time ruler (a faint background), not section dividers. On narrow screens the
 * whole grid scrolls horizontally inside its own container, so the page never
 * scrolls sideways.
 */
export function WeeklyGrid({ views, base, locale, t }: ViewProps) {
  const b = bounds(views);
  if (!b) return null;
  const startHour = Math.floor(b.start / 60);
  const endHour = Math.ceil(b.end / 60);
  const axisStart = startHour * 60;
  const height = (endHour - startHour) * HOUR_PX;
  const pxPerMin = HOUR_PX / 60;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  const days = [...new Set(views.map((v) => v.dayOfWeek))].sort((a, b2) => a - b2);
  const rulerStyle: React.CSSProperties = {
    height,
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX}px)`,
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex">
        <div className="w-12 shrink-0">
          <div className="h-8" />
          <div className="relative" style={{ height }}>
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
        </div>

        {days.map((day) => {
          const laid = assignLanes(views.filter((v) => v.dayOfWeek === day));
          return (
            <div key={day} className="min-w-[7.5rem] flex-1 px-0.5">
              <div className="flex h-8 items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
                <span aria-hidden="true">{dayShort(locale, day)}</span>
                <span className="sr-only">{dayName(locale, day)}</span>
              </div>
              <div className="relative" style={rulerStyle}>
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
          );
        })}
      </div>
    </div>
  );
}
