import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FilterableTimetable } from '@/app/_components/filterable-timetable';
import { FreshnessLine } from '@/app/_components/freshness';
import { PendingBadge } from '@/app/_components/timetable-grid';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; teacherId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, teacherId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  const teacher = await getQueries(slug).getTeacher(teacherId);
  const title = teacher?.name ?? translator(tenant.locale)('timetable.teacherTimetable');
  return pageMetadata({ tenant, title, path: `${await tenantBase(slug)}/teachers/${teacherId}` });
}

export default async function TeacherTimetable({ params }: Params) {
  const { slug, teacherId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const teacher = await queries.getTeacher(teacherId);
  if (!teacher) notFound();

  const [views, freshness] = await Promise.all([
    queries.teacherTimetable(teacherId),
    queries.freshness(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`${base}/timetable`} className="text-primary hover:underline">
              {tenant.displayName}
            </Link>{' '}
            · {t('timetable.teacherTimetable')}
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {teacher.name}
            {teacher.status === 'pending' ? <PendingBadge t={t} /> : null}
          </h1>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </div>
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={`${base}/teachers/${teacherId}/timetable.ics`}
        >
          {t('timetable.subscribe')}
        </Link>
      </header>

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <FilterableTimetable
          views={views}
          title={teacher.name}
          locale={tenant.locale}
          base={base}
        />
      )}
      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
