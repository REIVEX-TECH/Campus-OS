import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { FreshnessLine } from '@/app/_components/freshness';
import { SectionTimetableView } from '@/app/_components/section-timetable-view';
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1 px-1">
        <Link href={`${base}/timetable`} className="text-sm text-primary hover:underline">
          {tenant.displayName}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
      </header>

      <SectionTimetableView
        views={views}
        base={base}
        locale={tenant.locale}
        subscribeHref={`${base}/sections/${sectionId}/timetable.ics`}
      />

      {!term?.startsOn ? (
        <p className="px-1 text-xs text-muted-foreground">{t('timetable.termDatesPending')}</p>
      ) : null}
      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </main>
  );
}
