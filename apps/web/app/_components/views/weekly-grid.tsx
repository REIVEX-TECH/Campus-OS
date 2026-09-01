import { dayName, dayShort } from '../../../lib/i18n';
import { ClassBlock, type ViewProps } from './parts';
import { assignLanes, bounds, minutes } from './time-scale';

const HOUR_PX = 56;
const NOW_COLOR = 'oklch(0.62 0.22 25)'; // calendar-red "now" marker, reads in both themes

/**
 * Classic calendar: weekday columns, a left time gutter, colour-coded class
 * blocks placed and sized by time (overlaps split into side-by-side lanes). The
 * day-header row sticks below the app header on vertical scroll and the time
 * gutter sticks on horizontal scroll; on narrow screens the whole grid scrolls
 * horizontally inside its own container, so the page never scrolls sideways. The
 * hour lines are a time ruler (a faint background), not section dividers.
 */
export function WeeklyGrid({
  views,
  base,
  locale,
  t,
  now,
}: ViewProps & { now: { day: number; minutes: number } | null }) {
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
  const nowTop = now ? (now.minutes - axisStart) * pxPerMin : 0;
  const nowInRange = now !== null && now.minutes >= axisStart && now.minutes <= endHour * 60;

  return (
    // Keyboard-focusable scroll region: on narrow screens the grid scrolls
    // sideways, so it must be reachable and scrollable with the keyboard, and
    // named for screen readers.
    <div
      className="overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="region"
      aria-label={t('timetable.weekGrid')}
      tabIndex={0}
    >
      <div className="flex min-w-[44rem]">
        <div className="sticky left-0 z-10 w-12 shrink-0 bg-background">
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
          const showNow = nowInRange && now?.day === day;
          return (
            <div key={day} className="min-w-[7rem] flex-1 px-0.5">
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
                {showNow ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5"
                    style={{ top: nowTop, background: NOW_COLOR }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
