import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { TimeFormat } from '@campusos/core/time';
import { buttonVariants } from '@campusos/ui';
import type { TimetableView } from '@campusos/module-timetable/read';
import { translator } from '../../lib/i18n';
import { EmptyState } from './empty-state';
import { TimetableViews } from './timetable-views';

/**
 * The one section-timetable render, shared by the section page
 * (/sections/[id]) and the cascade picker's inline result (/timetable), so the
 * two paths can never drift. Renders the single pending-review note, the ICS
 * subscribe control, and the four-view switcher (or the empty state). Pass
 * `title` to show a heading above it (the picker has no section h1 of its own);
 * omit it where the page already titles the section.
 */
export function SectionTimetableView({
  views,
  base,
  locale,
  timeFormat,
  subscribeHref,
  title,
}: {
  views: TimetableView[];
  base: string;
  locale: string;
  timeFormat: TimeFormat;
  subscribeHref: string;
  title?: string;
}) {
  const t = translator(locale);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (views.length === 0 || sectionRef.current === null) return;

    function computeElementTopYPos(element: Element) {
      const eleYPos = element.getBoundingClientRect().y;
      const currYPos = window.scrollY;
      return eleYPos > currYPos ? eleYPos : currYPos - eleYPos;
    }

    window.scrollTo({ top: computeElementTopYPos(sectionRef.current), behavior: 'smooth' });
  }, []);

  if (views.length === 0) return <EmptyState title={t('timetable.empty.noEntries')} />;

  // view.pending already folds in the section's own pending status (see the read
  // layer's toView), so this one note covers both.
  const anyPending = views.some((v) => v.pending);

  return (
    <section ref={sectionRef} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
          {anyPending ? (
            <p className="text-xs text-muted-foreground">{t('timetable.pendingNote')}</p>
          ) : null}
        </div>
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={subscribeHref}
          data-print-hide
        >
          {t('timetable.subscribe')}
        </Link>
      </div>
      <TimetableViews views={views} base={base} locale={locale} timeFormat={timeFormat} />
    </section>
  );
}
