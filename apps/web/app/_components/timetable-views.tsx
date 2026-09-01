'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TimetableView } from '@campusos/module-timetable/read';
import { translator } from '../../lib/i18n';
import { CompactList } from './views/compact-list';
import { DayTabs } from './views/day-tabs';
import { Timeline } from './views/timeline';
import { WeeklyGrid } from './views/weekly-grid';

type ViewKey = 'grid' | 'days' | 'list' | 'timeline';

const ORDER: ViewKey[] = ['grid', 'days', 'list', 'timeline'];

/**
 * Client-side view switcher for a section timetable. The section data is fetched
 * on the server and passed in; switching is an INSTANT in-place toggle (local
 * state, no navigation) so the four views can be compared side by side. Default
 * is responsive (Grid on desktop, List on mobile), applied once on mount. Day-
 * scoped views (days, timeline) share a selected day, defaulting to today when it
 * has classes, and a live "now" marker is passed to the proportional views.
 */
export function TimetableViews({
  views,
  base,
  locale,
}: {
  views: TimetableView[];
  base: string;
  locale: string;
}) {
  const t = useMemo(() => translator(locale), [locale]);
  const days = useMemo(
    () => [...new Set(views.map((v) => v.dayOfWeek))].sort((a, b) => a - b),
    [views],
  );

  const [view, setView] = useState<ViewKey>('list');
  const [day, setDay] = useState<number>(days[0] ?? 1);
  const [now, setNow] = useState<{ day: number; minutes: number } | null>(null);

  // Responsive default + today, applied client-side (initial render is the
  // deterministic list/first-day, so there is no hydration mismatch).
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) setView('grid');
    const todayIso = ((new Date().getDay() + 6) % 7) + 1;
    if (days.includes(todayIso)) setDay(todayIso);
  }, [days]);

  // Live "now" marker for the grid/timeline, refreshed each minute.
  useEffect(() => {
    const tick = (): void => {
      const d = new Date();
      setNow({ day: ((d.getDay() + 6) % 7) + 1, minutes: d.getHours() * 60 + d.getMinutes() });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t('timetable.view.label')}
        className="inline-flex gap-1 self-start rounded-xl bg-input p-1"
      >
        {ORDER.map((key) => {
          const active = key === view;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setView(key)}
              className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium ${
                active ? 'ios-card text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`timetable.view.${key}`)}
            </button>
          );
        })}
      </div>

      {view === 'grid' ? (
        <WeeklyGrid views={views} base={base} locale={locale} t={t} now={now} />
      ) : null}
      {view === 'list' ? <CompactList views={views} base={base} locale={locale} t={t} /> : null}
      {view === 'days' ? (
        <DayTabs
          views={views}
          base={base}
          locale={locale}
          t={t}
          days={days}
          day={day}
          onDay={setDay}
        />
      ) : null}
      {view === 'timeline' ? (
        <Timeline
          views={views}
          base={base}
          locale={locale}
          t={t}
          days={days}
          day={day}
          onDay={setDay}
          now={now}
        />
      ) : null}
    </div>
  );
}
