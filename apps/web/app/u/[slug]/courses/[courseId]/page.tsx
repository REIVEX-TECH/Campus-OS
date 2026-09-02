import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { Card } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { JsonLd } from '@/app/_components/json-ld';
import { hhmm } from '@/app/_components/views/time-scale';
import { dayName, kindName, translator } from '@/lib/i18n';
import { courseLd } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { baseUrlFromHost } from '@/lib/tenant';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; courseId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, courseId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  const course = await getQueries(slug).getCourse(courseId);
  const title = course
    ? `${course.title} (${course.code})`
    : translator(tenant.locale)('search.heading');
  return pageMetadata({ tenant, title, path: `${await tenantBase(slug)}/courses/${courseId}` });
}

export default async function CoursePage({ params }: Params) {
  const { slug, courseId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const course = await queries.getCourse(courseId);
  if (!course) notFound();
  const views = await queries.courseTimetable(courseId);

  const host = (await headers()).get('host') ?? '';
  const tenantUrl = `${baseUrlFromHost(host)}${base}`;
  const courseUrl = `${tenantUrl}/courses/${courseId}`;

  const byDay = new Map<number, typeof views>();
  for (const v of views) {
    const list = byDay.get(v.dayOfWeek) ?? [];
    list.push(v);
    byDay.set(v.dayOfWeek, list);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-5">
      <JsonLd data={courseLd({ course, url: courseUrl, tenant, tenantUrl, sessions: views })} />
      <header className="flex flex-col gap-1 px-1">
        <Link href={`${base}/search`} className="text-sm text-primary hover:underline">
          {course.code}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{course.title}</h1>
        <p className="text-sm text-muted-foreground">{t('search.courseWhere')}</p>
      </header>

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((day) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {dayName(tenant.locale, day)}
              </h2>
              <Card className="p-4">
                <ul className="flex flex-col gap-5">
                  {(byDay.get(day) ?? []).map((v) => (
                    <li key={v.entryId} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">
                          {v.teacher ? (
                            <Link
                              href={`${base}/teachers/${v.teacher.id}`}
                              className="text-primary hover:underline"
                            >
                              {v.teacher.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{t('timetable.tba')}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {t('timetable.timeRange', {
                            start: hhmm(v.startsAt),
                            end: hhmm(v.endsAt),
                          })}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{kindName(tenant.locale, v.kind)}</span>
                        <span>
                          {t('timetable.room')}:{' '}
                          {v.room ? (
                            <Link
                              href={`${base}/rooms/${v.room.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {v.room.name}
                            </Link>
                          ) : (
                            <span>{t('timetable.tba')}</span>
                          )}
                        </span>
                        <Link
                          href={`${base}/sections/${v.section.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {t('timetable.section')} {v.section.name}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
