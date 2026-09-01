import Link from 'next/link';
import type { TimetableView } from '@campusos/module-timetable/read';
import { dayName, kindName, type Translate } from '../../../lib/i18n';
import { hhmm } from './time-scale';

export interface ViewProps {
  views: TimetableView[];
  base: string;
  locale: string;
  t: Translate;
}

export function timeRange(view: TimetableView, t: Translate): string {
  return t('timetable.timeRange', { start: hhmm(view.startsAt), end: hhmm(view.endsAt) });
}

export function cellAria(view: TimetableView, locale: string, t: Translate): string {
  return t('timetable.cellAria', {
    course: view.course.title,
    kind: kindName(locale, view.kind),
    day: dayName(locale, view.dayOfWeek),
    start: hhmm(view.startsAt),
    end: hhmm(view.endsAt),
    teacher: view.teacher?.name ?? t('timetable.tba'),
    room: view.room?.name ?? t('timetable.tba'),
  });
}

function Tba({ t, kind }: { t: Translate; kind: 'teacher' | 'room' }) {
  const aria = kind === 'teacher' ? t('timetable.tbaTeacherAria') : t('timetable.tbaRoomAria');
  return (
    <span className="text-muted-foreground" aria-label={aria}>
      {t('timetable.tba')}
    </span>
  );
}

/** Teacher and room, each a green link when known, else the accessible TBA text. */
export function Refs({ view, base, t }: { view: TimetableView; base: string; t: Translate }) {
  return (
    <>
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
    </>
  );
}

/** A full class row for the list and day views. */
export function ClassRow({
  view,
  base,
  locale,
  t,
}: {
  view: TimetableView;
  base: string;
  locale: string;
  t: Translate;
}) {
  return (
    <li className="flex flex-col gap-1" aria-label={cellAria(view, locale, t)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{view.course.title}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {timeRange(view, t)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{kindName(locale, view.kind)}</span>
        <Refs view={view} base={base} t={t} />
      </div>
    </li>
  );
}

/** A compact, positioned block for the weekly grid and timeline. */
export function ClassBlock({
  view,
  base,
  locale,
  t,
  style,
}: {
  view: TimetableView;
  base: string;
  locale: string;
  t: Translate;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="ios-card absolute overflow-hidden rounded-lg p-1.5"
      style={style}
      aria-label={cellAria(view, locale, t)}
    >
      <p className="truncate text-xs font-semibold leading-tight">{view.course.title}</p>
      <p className="truncate text-[11px] leading-tight text-muted-foreground">
        {hhmm(view.startsAt)}
      </p>
      {view.room ? (
        <p className="truncate text-[11px] leading-tight">
          <Link href={`${base}/rooms/${view.room.id}`} className="text-primary hover:underline">
            {view.room.name}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
