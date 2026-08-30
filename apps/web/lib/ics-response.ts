import type { TenantConfig } from '@campusos/core/tenant';
import { toICS } from '@campusos/module-timetable/ics';
import type { TermSummary, TimetableView } from '@campusos/module-timetable/read';
import { translator } from './i18n';

/** Build a text/calendar Response from timetable views (recurring, tenant tz). */
export function icsResponse(opts: {
  tenant: TenantConfig;
  views: TimetableView[];
  term: TermSummary | null;
  calendarName: string;
}): Response {
  const t = translator(opts.tenant.locale);
  const anchor = opts.term?.startsOn ?? new Date().toISOString().slice(0, 10);
  const body = toICS(opts.views, {
    tzid: opts.tenant.timezone,
    calendarName: opts.calendarName,
    anchor,
    termEnd: opts.term?.endsOn ?? null,
    domain: opts.tenant.slug,
    labels: {
      tba: t('timetable.tba'),
      teacher: t('timetable.teacher'),
      section: t('timetable.section'),
      pendingNote: t('timetable.unverifiedAria'),
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="timetable.ics"',
      'cache-control': 'public, max-age=3600',
    },
  });
}
