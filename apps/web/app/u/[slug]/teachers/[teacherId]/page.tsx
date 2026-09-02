import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FilterableTimetable } from '@/app/_components/filterable-timetable';
import { FreshnessLine } from '@/app/_components/freshness';
import { FreeSlotsCard } from '@/app/_components/profile/free-slots-card';
import { ProfileBreadcrumb } from '@/app/_components/profile/profile-breadcrumb';
import { ProfileHeader } from '@/app/_components/profile/profile-header';
import { StatGrid } from '@/app/_components/profile/stat-grid';
import { PendingBadge } from '@/app/_components/timetable-grid';
import { countText, dayName, translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { formatDuration, timetableStats } from '@/lib/timetable-stats';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; teacherId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, teacherId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  const teacher = await getQueries(slug).getTeacher(teacherId);
  if (!teacher) return {};
  return pageMetadata({
    tenant,
    title: teacher.name,
    path: `${await tenantBase(slug)}/teachers/${teacherId}`,
  });
}

/**
 * A teacher profile: who they are, what their week looks like in figures, the
 * courses they carry, when they are free, and the timetable itself. Every number
 * is derived from the class list already fetched for the timetable, so the page
 * makes no extra reads and the figures can never disagree with the grid below.
 */
export default async function TeacherProfile({ params }: Params) {
  const { slug, teacherId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const teacher = await queries.getTeacher(teacherId);
  if (!teacher) notFound();

  const [views, freshness, window] = await Promise.all([
    queries.teacherTimetable(teacherId),
    queries.freshness(),
    queries.teachingWindow(),
  ]);

  const stats = timetableStats(views, window);
  const figures = [
    { label: t('profile.classes'), value: String(stats.classes) },
    { label: t('profile.hours'), value: formatDuration(stats.busyMinutes) },
    { label: t('profile.days'), value: String(stats.days.length) },
    { label: t('profile.courses'), value: String(stats.courses.length) },
    {
      label: t('profile.busiest'),
      value: stats.busiestDay ? dayName(tenant.locale, stats.busiestDay) : t('timetable.tba'),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ProfileHeader
        seed={teacher.id}
        title={teacher.name}
        badge={teacher.status === 'pending' ? <PendingBadge t={t} /> : undefined}
        context={
          <ProfileBreadcrumb href={`${base}/teachers`} label={t('teachers.heading')}>
            <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
          </ProfileBreadcrumb>
        }
        actions={
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={`${base}/teachers/${teacherId}/timetable.ics`}
          >
            {t('timetable.subscribe')}
          </Link>
        }
      />

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <>
          <StatGrid stats={figures} />

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section className="ios-card flex min-w-0 flex-col gap-3 rounded-2xl p-4">
              <h2 className="text-base font-semibold">{t('profile.coursesTaught')}</h2>
              <ul className="flex flex-col gap-2">
                {stats.courses.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-baseline justify-between gap-3">
                    <Link
                      href={`${base}/courses/${c.id}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {countText(tenant.locale, 'classes', c.classes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <FreeSlotsCard
              freeByDay={stats.freeByDay}
              window={window}
              locale={tenant.locale}
              t={t}
            />
          </div>

          <FilterableTimetable
            views={views}
            title={teacher.name}
            locale={tenant.locale}
            base={base}
          />
        </>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
