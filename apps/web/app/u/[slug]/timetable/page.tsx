import type { Metadata } from 'next';
import { CalendarSearch } from 'lucide-react';
import Link from 'next/link';
import { tenantRegistry } from '@campusos/tenants';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { PageShell } from '@/app/_components/page-shell';
import { RecentTimetables } from '@/app/_components/recent-timetables';
import { RecordRecent } from '@/app/_components/record-recent';
import { SectionTimetableView } from '@/app/_components/section-timetable-view';
import { TimetableWorkspace } from '@/app/_components/timetable-workspace';
import { listRecents } from '@campusos/module-identity/recents';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { tenantNow, toHHMM } from '@/lib/tenant-time';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

// Visual only: the workspace owns the live region (a permanent role="status"
// whose text toggles on pending), so this is decorative and hidden from AT.
function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="h-6 w-40 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-8 w-28 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
      <div className="h-9 w-60 max-w-full animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
    </div>
  );
}

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
  const sectionSummary = section ? sections.find((s) => s.id === section) : undefined;
  const views = section ? await queries.sectionTimetable(section) : [];

  // Where they were recently. Cheap signed out: no cookie, no database.
  const actor = await currentActor();
  const recents = actor ? await listRecents(actor.userId, slug) : [];
  const signedIn = actor !== null;

  // Rail (xl only): which rooms are free right now, plus quick links.
  const nowT = tenantNow(tenant.timezone);
  const freeNow = term
    ? await queries.freeRooms({
        termId: term,
        dayOfWeek: nowT.dayOfWeek,
        startsAt: toHHMM(nowT.minutes),
        endsAt: toHHMM(Math.min(nowT.minutes + 60, 24 * 60 - 1)),
      })
    : [];

  const rail =
    terms.length === 0 ? undefined : (
      <div className="ios-card flex flex-col gap-3 rounded-2xl p-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold">{t('timetable.freeNow')}</h2>
          <p className="text-sm text-muted-foreground">
            {freeNow.length > 0
              ? `${freeNow
                  .slice(0, 5)
                  .map((r) => r.name)
                  .join(', ')}${freeNow.length > 5 ? ` +${freeNow.length - 5}` : ''}`
              : t('freeRooms.none')}
          </p>
          <Link
            href={`${base}/free-rooms`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('timetable.allFreeRooms')}
          </Link>
        </div>
        <Link href={`${base}/search`} className="text-sm font-medium text-primary hover:underline">
          {t('search.placeholder')}
        </Link>
      </div>
    );

  return (
    <PageShell rail={rail}>
      <div className="flex flex-col gap-5">
        <header className="px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('timetable.heading')}</h1>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </header>

        {terms.length === 0 ? (
          <EmptyState title={t('timetable.empty.noTerms')} />
        ) : (
          <TimetableWorkspace
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
              programLocked: t('timetable.programLocked'),
              sectionLocked: t('timetable.sectionLocked'),
            }}
            aside={
              <RecentTimetables
                tenant={slug}
                signedIn={signedIn}
                initial={recents.map((r) => ({ ...r, viewedAt: r.viewedAt.getTime() }))}
                labels={{
                  heading: t('timetable.recent.heading'),
                  clear: t('timetable.recent.clear'),
                  kind: {
                    section: t('timetable.recent.kind.section'),
                    teacher: t('timetable.recent.kind.teacher'),
                    room: t('timetable.recent.kind.room'),
                  },
                }}
              />
            }
            skeleton={<ResultsSkeleton />}
            loadingLabel={t('a11y.loading')}
            results={
              section && sectionSummary ? (
                <>
                  <RecordRecent
                    tenant={slug}
                    signedIn={signedIn}
                    entry={{
                      kind: 'section',
                      key: section,
                      label: `${sectionSummary.program.code} ${sectionSummary.name}`,
                      href: `${base}/timetable?term=${encodeURIComponent(term ?? '')}&program=${encodeURIComponent(program ?? '')}&section=${encodeURIComponent(section)}`,
                    }}
                  />
                  <SectionTimetableView
                    views={views}
                    base={base}
                    locale={tenant.locale}
                    subscribeHref={`${base}/sections/${section}/timetable.ics`}
                    title={`${sectionSummary.program.code} ${sectionSummary.name}`}
                  />
                </>
              ) : (
                <EmptyState title={t('timetable.pickPrompt')} icon={CalendarSearch} />
              )
            }
          />
        )}

        <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
      </div>
    </PageShell>
  );
}
