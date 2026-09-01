import type { Metadata } from 'next';
import { tenantRegistry } from '@campusos/tenants';
import { Card } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { SectionTimetableView } from '@/app/_components/section-timetable-view';
import { TimetablePicker } from '@/app/_components/timetable-picker';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ term?: string; program?: string; section?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('timetable.heading'),
    path: `${await tenantBase(slug)}/timetable`,
  });
}

export default async function TimetablePickerPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const [terms, freshness] = await Promise.all([
    queries.listTermsWithSections(),
    queries.freshness(),
  ]);

  // Default to the first term-with-sections so the program step is ready with
  // no clicks; validate query params against real data.
  const term = terms.find((x) => x.id === sp.term)?.id ?? terms[0]?.id;
  const programs = term ? await queries.listProgramsByTerm(term) : [];
  const program = programs.find((p) => p.id === sp.program)?.id;
  const sections = term && program ? await queries.listSectionsByProgramTerm(term, program) : [];
  const section = sections.find((s) => s.id === sp.section)?.id;
  const views = section ? await queries.sectionTimetable(section) : [];
  const sectionSummary = section ? sections.find((s) => s.id === section) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="px-1">
        <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
        <h1 className="text-3xl font-bold tracking-tight">{t('timetable.heading')}</h1>
        <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
      </header>

      {terms.length === 0 ? (
        <EmptyState title={t('timetable.empty.noTerms')} />
      ) : (
        <>
          <Card className="w-full max-w-xl p-5">
            <TimetablePicker
              terms={terms.map((x) => ({ id: x.id, label: x.name }))}
              programs={programs.map((p) => ({ id: p.id, label: p.name }))}
              sections={sections.map((s) => ({ id: s.id, label: s.name }))}
              term={term}
              program={program}
              section={section}
              labels={{
                semester: t('timetable.semester'),
                program: t('timetable.program'),
                section: t('timetable.section'),
                chooseSemester: t('timetable.chooseSemester'),
                chooseProgram: t('timetable.chooseProgram'),
                chooseSection: t('timetable.chooseSection'),
              }}
            />
          </Card>

          {section && sectionSummary ? (
            <SectionTimetableView
              views={views}
              base={base}
              locale={tenant.locale}
              subscribeHref={`${base}/sections/${section}/timetable.ics`}
              title={`${sectionSummary.program.code} ${sectionSummary.name}`}
            />
          ) : (
            <EmptyState title={t('timetable.pickPrompt')} />
          )}
        </>
      )}

      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
