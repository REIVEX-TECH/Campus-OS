'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TimetableView } from '@campusos/module-timetable/read';
import type { TimeFormat } from '@campusos/core/time';
import { translator } from '../../lib/i18n';
import { Card } from '@campusos/ui';
import { CompactList } from './views/compact-list';
import { DayTabs } from './views/day-tabs';
import { FilterDialog } from './views/filter-dialog';
import { Timeline } from './views/timeline';
import { FilterToggle, TimetableFilters, useTimetableFilters } from './views/timetable-filters';
import { WeeklyGrid } from './views/weekly-grid';

type ViewKey = 'grid' | 'days' | 'list' | 'timeline';

const ORDER: ViewKey[] = ['grid', 'days', 'list', 'timeline'];

/**
 * Client-side view switcher for a section timetable. The section data is fetched
 * on the server and passed in; switching is an INSTANT in-place toggle (local
 * state, no navigation) so the four views can be compared side by side. Optional
 * filters (a time window plus day, type, class, teacher, and room toggles) are
 * collapsed by default and apply to every view. Day-scoped views (days, timeline)
 * share a selected day, defaulting to today when it has classes, and a live "now"
 * marker is passed to the proportional views.
 */
export function TimetableViews({
  views,
  base,
  locale,
  timeFormat,
}: {
  views: TimetableView[];
  base: string;
  locale: string;
  timeFormat: TimeFormat;
}) {
  const t = useMemo(() => translator(locale), [locale]);
  const { filtered, open, setOpen, activeCount, filterProps } = useTimetableFilters(views, locale);

  const allDays = useMemo(
    () => [...new Set(views.map((v) => v.dayOfWeek))].sort((a, b) => a - b),
    [views],
  );
  const days = useMemo(
    () => [...new Set(filtered.map((v) => v.dayOfWeek))].sort((a, b) => a - b),
    [filtered],
  );

  const [view, setView] = useState<ViewKey>('list');
  const [day, setDay] = useState<number>(1);
  const [now, setNow] = useState<{ day: number; minutes: number } | null>(null);

  // Responsive default view + default day (today if present), on the section's
  // data (not on filter changes).
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) setView('grid');
    const todayIso = ((new Date().getDay() + 6) % 7) + 1;
    setDay(allDays.includes(todayIso) ? todayIso : (allDays[0] ?? 1));
  }, [allDays]);

  // Keep the selected day valid as filters narrow the available days.
  useEffect(() => {
    if (days.length > 0 && !days.includes(day)) setDay(days[0] ?? 1);
  }, [days, day]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={t('timetable.view.label')}
          data-print-hide
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
                  active
                    ? 'ios-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`timetable.view.${key}`)}
              </button>
            );
          })}
        </div>

        <FilterToggle open={open} setOpen={setOpen} activeCount={activeCount} t={t} />
      </div>

      <FilterDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('timetable.filters')}
        closeLabel={t('a11y.close')}
      >
        <TimetableFilters {...filterProps} />
      </FilterDialog>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {t('timetable.filters.none')}
        </Card>
      ) : (
        <>
          {view === 'grid' ? (
            <WeeklyGrid
              views={filtered}
              base={base}
              locale={locale}
              timeFormat={timeFormat}
              t={t}
              now={now}
            />
          ) : null}
          {view === 'list' ? (
            <CompactList
              views={filtered}
              base={base}
              locale={locale}
              timeFormat={timeFormat}
              t={t}
            />
          ) : null}
          {view === 'days' ? (
            <DayTabs
              views={filtered}
              base={base}
              locale={locale}
              timeFormat={timeFormat}
              t={t}
              days={days}
              day={day}
              onDay={setDay}
            />
          ) : null}
          {view === 'timeline' ? (
            <Timeline
              views={filtered}
              base={base}
              locale={locale}
              timeFormat={timeFormat}
              t={t}
              days={days}
              day={day}
              onDay={setDay}
              now={now}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
