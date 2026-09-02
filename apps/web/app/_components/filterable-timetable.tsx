'use client';

import { useMemo } from 'react';
import { Card } from '@campusos/ui';
import type { TimetableView } from '@campusos/module-timetable/read';
import { translator } from '../../lib/i18n';
import { TimetableGrid } from './timetable-grid';
import { FilterDialog } from './views/filter-dialog';
import { FilterToggle, TimetableFilters, useTimetableFilters } from './views/timetable-filters';

/**
 * The single-grid timetable (teacher / room pages) with the same optional filters
 * as the section view. A client wrapper: the server passes the class list; the
 * filter state lives here and the day-grouped grid renders the filtered result.
 * Filter groups that offer only one value (e.g. the teacher on a teacher page)
 * hide themselves.
 */
export function FilterableTimetable({
  views,
  title,
  base,
  locale,
}: {
  views: TimetableView[];
  title: string;
  base: string;
  locale: string;
}) {
  const t = useMemo(() => translator(locale), [locale]);
  const { filtered, open, setOpen, activeCount, filterProps } = useTimetableFilters(views, locale);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end" data-print-hide>
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
        <TimetableGrid views={filtered} title={title} locale={locale} base={base} t={t} />
      )}
    </div>
  );
}
