import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { PendingBadge, TimetableGrid } from '@/app/_components/timetable-grid';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; sectionId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, sectionId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  const section = await getQueries(slug).getSection(sectionId);
  const title = section
    ? `${section.program.code} ${section.name}`
    : translator(tenant.locale)('timetable.heading');
  return pageMetadata({
    tenant,
    title,
    path: `${await tenantBase(slug)}/sections/${sectionId}`,
  });
}

export default async function SectionTimetable({ params }: Params) {
  const { slug, sectionId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const section = await queries.getSection(sectionId);
  if (!section) notFound();

  const [views, term, freshness] = await Promise.all([
    queries.sectionTimetable(sectionId),
    queries.getTerm(section.termId),
    queries.freshness(),
  ]);
  const title = `${section.program.code} ${section.name}`;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href={`${base}/timetable`} className="hover:underline">
              {tenant.displayName}
            </Link>
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {title}
            {section.status === 'pending' ? <PendingBadge t={t} /> : null}
          </h1>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </div>
        <Link
          className={buttonVariants({ variant: 'outline' })}
          href={`${base}/sections/${sectionId}/timetable.ics`}
        >
          {t('timetable.subscribe')}
        </Link>
      </header>

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <TimetableGrid views={views} title={title} locale={tenant.locale} t={t} />
      )}

      {!term?.startsOn ? (
        <p className="mt-4 text-xs text-muted-foreground">{t('timetable.termDatesPending')}</p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </main>
  );
}
