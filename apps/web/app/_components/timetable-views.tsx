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
 * state, no navigation) so the four views can be compared side by side. Day-
 * scoped views (days, timeline) share a selected-day state, defaulting to today
 * when it has classes.
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

  // Open day-scoped views on today when it has classes (client-only, so no
  // hydration mismatch: the initial render uses the deterministic first day).
  useEffect(() => {
    const todayIso = ((new Date().getDay() + 6) % 7) + 1;
    if (days.includes(todayIso)) setDay(todayIso);
  }, [days]);

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

      {view === 'grid' ? <WeeklyGrid views={views} base={base} locale={locale} t={t} /> : null}
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
        />
      ) : null}
    </div>
  );
}
