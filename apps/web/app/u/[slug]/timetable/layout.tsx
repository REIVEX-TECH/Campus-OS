import type { ReactNode } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { PageShell } from '@/app/_components/page-shell';
import { TimetableSelectors } from '@/app/_components/timetable-selectors';
import { listRecents } from '@campusos/module-identity/recents';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { tenantNow, toHHMM } from '@/lib/tenant-time';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * The timetable surface renders its chrome once, here: the header, the free-rooms
 * rail, the cascade selectors, and the "Recently viewed" sidebar. Selecting a term,
 * program or section changes only the `[[...filters]]` child route (the schedule pane),
 * so this layout is preserved across the navigation and the selectors + sidebar never
 * unmount or flicker (the messages two-pane pattern). The client selectors read the
 * active selection from the route themselves. The full cascade is preloaded once here
 * (loaded per page load, not per selection) so switching is a client-side round trip
 * against data already in the browser; the schedule pane still renders server-side from
 * the URL segment (metadata + canonical live on the child page).
 */
export default async function TimetableLayout({
  params,
  children,
}: Params & { children: ReactNode }) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const timetablePath = `${base}/timetable`;
  const queries = getQueries(slug);

  const [terms, freshness] = await Promise.all([
    queries.listTermsWithSections(),
    queries.freshness(),
  ]);

  // The whole cascade, loaded once, so the client picker can switch term -> program ->
  // section without a server round trip. Each row is tiny (id + name + parent ids).
  const [programsByTerm, sectionsByTerm] = await Promise.all([
    Promise.all(terms.map((tm) => queries.listProgramsByTerm(tm.id))),
    Promise.all(terms.map((tm) => queries.listSectionsByTerm(tm.id))),
  ]);
  const programs = terms.flatMap((tm, i) =>
    programsByTerm[i]!.map((p) => ({ id: p.id, label: p.name, termId: tm.id })),
  );
  const sections = terms.flatMap((tm, i) =>
    sectionsByTerm[i]!.map((s) => ({
      id: s.id,
      label: s.name,
      termId: tm.id,
      programId: s.program.id,
    })),
  );

  const actor = await currentActor();
  const recents = actor ? await listRecents(actor.userId, slug) : [];
  const signedIn = actor !== null;

  // Rail (xl only): which rooms are free right now, plus quick links.
  const nowT = tenantNow(tenant.timezone);
  const freeNow =
    terms.length > 0
      ? await queries.freeRooms({
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
          <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
            <TimetableSelectors
              basePath={timetablePath}
              tenant={slug}
              signedIn={signedIn}
              terms={terms.map((x) => ({ id: x.id, label: x.name }))}
              programs={programs}
              sections={sections}
              recents={recents.map((r) => ({ ...r, viewedAt: r.viewedAt.getTime() }))}
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
              recentLabels={{
                heading: t('timetable.recent.heading'),
                clear: t('timetable.recent.clear'),
                kind: {
                  section: t('timetable.recent.kind.section'),
                  teacher: t('timetable.recent.kind.teacher'),
                  room: t('timetable.recent.kind.room'),
                },
              }}
            />
            <div className="min-w-0">{children}</div>
          </div>
        )}

        <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
      </div>
    </PageShell>
  );
}
