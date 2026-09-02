import Link from 'next/link';
import type { TimetableView } from '@campusos/module-timetable/read';
import { Badge, Card } from '@campusos/ui';
import { dayName, kindName, type Translate } from '../../lib/i18n';

/** Trim a wall-clock time ("08:00:00" or "08:00") to "HH:MM" for display. */
const hhmm = (time: string): string => time.slice(0, 5);

function Tba({ t, kind }: { t: Translate; kind: 'teacher' | 'room' }) {
  const aria = kind === 'teacher' ? t('timetable.tbaTeacherAria') : t('timetable.tbaRoomAria');
  return (
    <span className="text-muted-foreground" aria-label={aria}>
      {t('timetable.tba')}
    </span>
  );
}

export function PendingBadge({ t }: { t: Translate }) {
  return (
    <Badge
      variant="warning"
      aria-label={t('timetable.unverifiedAria')}
      title={t('timetable.unverifiedAria')}
    >
      {t('timetable.unverified')}
    </Badge>
  );
}

function EntryRow({
  view,
  locale,
  base,
  t,
}: {
  view: TimetableView;
  locale: string;
  base: string;
  t: Translate;
}) {
  const aria = t('timetable.cellAria', {
    course: view.course.title,
    kind: kindName(locale, view.kind),
    day: dayName(locale, view.dayOfWeek),
    start: hhmm(view.startsAt),
    end: hhmm(view.endsAt),
    teacher: view.teacher?.name ?? t('timetable.tba'),
    room: view.room?.name ?? t('timetable.tba'),
  });
  return (
    <li className="flex flex-col gap-1" aria-label={aria}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{view.course.title}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {t('timetable.timeRange', { start: hhmm(view.startsAt), end: hhmm(view.endsAt) })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{kindName(locale, view.kind)}</span>
        <span>
          {t('timetable.teacher')}:{' '}
          {view.teacher ? (
            <Link
              href={`${base}/teachers/${view.teacher.id}`}
              className="font-medium text-primary hover:underline"
            >
              {view.teacher.name}
            </Link>
          ) : (
            <Tba t={t} kind="teacher" />
          )}
        </span>
        <span>
          {t('timetable.room')}:{' '}
          {view.room ? (
            <Link
              href={`${base}/rooms/${view.room.id}`}
              className="font-medium text-primary hover:underline"
            >
              {view.room.name}
            </Link>
          ) : (
            <Tba t={t} kind="room" />
          )}
        </span>
      </div>
      {view.pending ? (
        <span className="inline-flex">
          <PendingBadge t={t} />
        </span>
      ) : null}
    </li>
  );
}

/**
 * iOS day-grouped timetable: one white grouped card per weekday, its classes as
 * rows separated by spacing (no divider lines). Mobile-first and readable as a
 * day-by-day list; on wider screens the same list centres in a column. Semantic
 * structure preserved: a heading per day and a list of classes with aria labels.
 */
export function TimetableGrid({
  views,
  title,
  locale,
  base,
  t,
}: {
  views: TimetableView[];
  title: string;
  locale: string;
  base: string;
  t: Translate;
}) {
  const byDay = new Map<number, TimetableView[]>();
  for (const view of views) {
    const list = byDay.get(view.dayOfWeek) ?? [];
    list.push(view);
    byDay.set(view.dayOfWeek, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <section className="flex flex-col gap-5">
      <h2 className="sr-only">{t('timetable.gridCaption', { name: title })}</h2>
      {days.map((day) => (
        <section key={day} className="flex flex-col gap-2">
          <h3 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {dayName(locale, day)}
          </h3>
          <Card className="flex flex-col gap-5 p-4">
            <ul className="flex flex-col gap-5">
              {(byDay.get(day) ?? []).map((view) => (
                <EntryRow key={view.entryId} view={view} locale={locale} base={base} t={t} />
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </section>
  );
}
