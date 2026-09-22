import type { Metadata } from 'next';
import { CalendarSearch } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTenantRegistry } from '@/lib/tenants';
import { EmptyState } from '@/app/_components/empty-state';
import { RecordRecent } from '@/app/_components/record-recent';
import { SectionTimetableView } from '@/app/_components/section-timetable-view';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { buildTimetablePath, parseTimetableFilters } from '@/lib/timetable-url';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

// The schedule pane of the timetable surface. The chrome (header, selectors, sidebar,
// rail) lives in the layout and is preserved across selections; only this child route
// re-renders when the term/program/section path changes. `filters` is the optional
// catch-all (/timetable/t/{term}/p/{program}/s/{section}); the legacy `?term&...` form is
// 301'd to it from middleware.
type Params = {
  params: Promise<{ slug: string; filters?: string[] }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, filters } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const sel = parseTimetableFilters(filters);

  // Title and canonical come from the resolved names, not the ids. A fully chosen
  // section shares the dedicated /sections/{id} page's title and canonicalises to it,
  // so there is one canonical per section; partial states canonicalise to /timetable.
  let title = t('timetable.heading');
  let path = `${base}/timetable`;
  if (sel?.section) {
    const section = await getQueries(slug).getSection(sel.section);
    if (section) {
      title = `${section.program.code} ${section.name}`;
      path = `${base}/sections/${sel.section}`;
    }
  } else if (sel?.term) {
    const queries = getQueries(slug);
    const term = await queries.getTerm(sel.term);
    if (sel.program) {
      const program = (await queries.listProgramsByTerm(sel.term)).find(
        (p) => p.id === sel.program,
      );
      if (program && term) title = `${program.name} · ${term.name}`;
    } else if (term) {
      title = term.name;
    }
  }
  return pageMetadata({ tenant, title, path });
}

export default async function TimetableSchedulePane({ params }: Params) {
  const { slug, filters } = await params;
  const sel = parseTimetableFilters(filters);
  if (!sel) notFound();
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const timetablePath = `${base}/timetable`;
  const queries = getQueries(slug);

  // No section chosen yet: the layout shows the picker; this pane invites a choice.
  const section = sel.section ? await queries.getSection(sel.section) : null;
  if (!section) {
    return <EmptyState title={t('timetable.pickPrompt')} icon={CalendarSearch} />;
  }

  const views = await queries.sectionTimetable(section.id);
  const title = `${section.program.code} ${section.name}`;
  const actor = await currentActor();

  return (
    <>
      <RecordRecent
        tenant={slug}
        signedIn={actor !== null}
        entry={{
          kind: 'section',
          key: section.id,
          label: title,
          href: buildTimetablePath(timetablePath, {
            term: section.termId,
            program: section.program.id,
            section: section.id,
          }),
        }}
      />
      <SectionTimetableView
        timeFormat={tenant.timeFormat}
        views={views}
        base={base}
        locale={tenant.locale}
        subscribeHref={`${base}/sections/${section.id}/timetable.ics`}
        title={title}
      />
    </>
  );
}
