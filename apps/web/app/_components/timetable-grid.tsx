import type { TimetableView } from '@campusos/module-timetable/read';
import { buildWeekGrid } from '@campusos/module-timetable/read';
import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@campusos/ui';
import { dayName, kindName, type Translate } from '../../lib/i18n';

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

function EntryCell({ view, locale, t }: { view: TimetableView; locale: string; t: Translate }) {
  const teacherName = view.teacher?.name ?? null;
  const roomName = view.room?.name ?? null;
  const aria = t('timetable.cellAria', {
    course: view.course.title,
    kind: kindName(locale, view.kind),
    day: dayName(locale, view.dayOfWeek),
    start: view.startsAt,
    end: view.endsAt,
    teacher: teacherName ?? t('timetable.tba'),
    room: roomName ?? t('timetable.tba'),
  });
  return (
    <div className="rounded-md bg-surface p-2 text-xs text-surface-foreground" aria-label={aria}>
      <div className="font-medium">{view.course.title}</div>
      <div className="text-muted-foreground">{kindName(locale, view.kind)}</div>
      <div>
        {t('timetable.teacher')}: {teacherName ?? <Tba t={t} kind="teacher" />}
      </div>
      <div>
        {t('timetable.room')}: {roomName ?? <Tba t={t} kind="room" />}
      </div>
      {view.pending ? (
        <span className="mt-1 inline-block">
          <PendingBadge t={t} />
        </span>
      ) : null}
    </div>
  );
}

export function TimetableGrid({
  views,
  title,
  locale,
  t,
}: {
  views: TimetableView[];
  title: string;
  locale: string;
  t: Translate;
}) {
  const grid = buildWeekGrid(views);
  return (
    <Table>
      <TableCaption>{t('timetable.gridCaption', { name: title })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('timetable.time')}</TableHead>
          {grid.days.map((day) => (
            <TableHead key={day} scope="col">
              {dayName(locale, day)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {grid.rows.map((row) => (
          <TableRow key={`${row.startsAt}-${row.endsAt}`}>
            <TableHead scope="row" className="whitespace-nowrap font-normal text-foreground">
              {t('timetable.timeRange', { start: row.startsAt, end: row.endsAt })}
            </TableHead>
            {grid.days.map((day) => (
              <TableCell key={day}>
                <div className="flex flex-col gap-2">
                  {(row.byDay[day] ?? []).map((view) => (
                    <EntryCell key={view.entryId} view={view} locale={locale} t={t} />
                  ))}
                </div>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
