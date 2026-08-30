import type { TimetableView } from '../types';
import { computeUids } from './uid';
import { offsetToMinutes, tzInfo, vtimezoneBlock } from './vtimezone';

export interface IcsLabels {
  tba: string;
  teacher: string;
  section: string;
  pendingNote: string;
}

const DEFAULT_LABELS: IcsLabels = {
  tba: 'TBA',
  teacher: 'Teacher',
  section: 'Section',
  pendingNote: 'Auto-imported, pending review',
};

export interface IcsOptions {
  tzid: string;
  calendarName: string;
  /** First-occurrence anchor date "YYYY-MM-DD" (e.g. term.startsOn ?? today). */
  anchor: string;
  /** Term end "YYYY-MM-DD" → RRULE UNTIL; omit/null for open-ended weekly. */
  termEnd?: string | null;
  domain?: string;
  labels?: Partial<IcsLabels>;
}

const BYDAY: Record<number, string> = {
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
  7: 'SU',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hms(time: string): string {
  const [h = '0', m = '0', s = '0'] = time.split(':');
  return `${pad(Number(h))}${pad(Number(m))}${pad(Number(s))}`;
}

function byday(dayOfWeek: number): string {
  const code = BYDAY[dayOfWeek];
  if (!code) throw new Error(`invalid ISO day of week: ${dayOfWeek}`);
  return code;
}

/** First date >= anchor whose ISO weekday matches, as "YYYYMMDD". */
function firstOccurrence(anchor: string, dayOfWeek: number): string {
  const [y = 0, m = 1, d = 1] = anchor.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const isoDay = ((dt.getUTCDay() + 6) % 7) + 1;
  dt.setUTCDate(dt.getUTCDate() + ((dayOfWeek - isoDay + 7) % 7));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function toUtcStamp(iso: string): string {
  const dt = new Date(iso);
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`
  );
}

function untilUtc(termEnd: string, tzid: string): string {
  const offset = offsetToMinutes(tzInfo(tzid).offset);
  const [y = 0, m = 1, d = 1] = termEnd.split('-').map(Number);
  const localEnd = Date.UTC(y, m - 1, d, 23, 59, 59);
  const utc = new Date(localEnd - offset * 60_000);
  return toUtcStamp(utc.toISOString());
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold lines to <=74 chars per RFC 5545 (CRLF + leading space continuation). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/**
 * Render current timetable views as an RFC 5545 calendar with recurring
 * wall-clock events (VTIMEZONE + TZID per CLAUDE.md §5). Throws on an
 * unsupported/DST timezone rather than emitting a wrong VTIMEZONE.
 */
export function toICS(views: readonly TimetableView[], options: IcsOptions): string {
  tzInfo(options.tzid); // fail loudly on unsupported/DST zones before emitting anything
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const uids = computeUids(views, options.domain);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus OS//Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    `X-WR-TIMEZONE:${options.tzid}`,
    ...vtimezoneBlock(options.tzid),
  ];

  for (const view of views) {
    const uid = uids.get(view.entryId);
    if (!uid) continue;
    const date = firstOccurrence(options.anchor, view.dayOfWeek);
    const rrule =
      `RRULE:FREQ=WEEKLY;BYDAY=${byday(view.dayOfWeek)}` +
      (options.termEnd ? `;UNTIL=${untilUtc(options.termEnd, options.tzid)}` : '');
    const teacher = view.teacher ? view.teacher.name : labels.tba;
    const room = view.room ? view.room.name : labels.tba;
    const description =
      `${labels.teacher}: ${teacher}\n${labels.section}: ${view.section.name}` +
      (view.pending ? `\n(${labels.pendingNote})` : '');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SEQUENCE:${Math.floor(new Date(view.validFrom).getTime() / 1000)}`,
      `DTSTAMP:${toUtcStamp(view.validFrom)}`,
      `SUMMARY:${escapeText(`${view.course.title} (${view.kind})`)}`,
      `DTSTART;TZID=${options.tzid}:${date}T${hms(view.startsAt)}`,
      `DTEND;TZID=${options.tzid}:${date}T${hms(view.endsAt)}`,
      rrule,
      `LOCATION:${escapeText(room)}`,
      `DESCRIPTION:${escapeText(description)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
