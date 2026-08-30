import type { Metadata } from 'next';
import Link from 'next/link';
import { tenantRegistry } from '@campusos/tenants';
import type { SectionSummary } from '@campusos/module-timetable/read';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { PendingBadge } from '@/app/_components/timetable-grid';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('timetable.heading'),
    path: `/u/${slug}/timetable`,
  });
}

export default async function TimetablePicker({ params }: Params) {
  const { slug } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const queries = getQueries(slug);

  const [terms, freshness] = await Promise.all([queries.listTerms(), queries.freshness()]);
  const term = terms[0] ?? null;
  const sections = term ? await queries.listSectionsByTerm(term.id) : [];

  const byProgram = new Map<string, SectionSummary[]>();
  for (const section of sections) {
    const list = byProgram.get(section.program.code) ?? [];
    list.push(section);
    byProgram.set(section.program.code, list);
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          {tenant.displayName} — {t('timetable.heading')}
        </h1>
        <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
      </header>

      {!term ? (
        <EmptyState title={t('timetable.empty.noTerms')} />
      ) : sections.length === 0 ? (
        <EmptyState title={t('timetable.empty.noSections')} />
      ) : (
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-medium">{t('timetable.chooseSection')}</h2>
          {[...byProgram.entries()].map(([code, list]) => (
            <section key={code}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{code}</h3>
              <ul className="flex flex-wrap gap-2">
                {list.map((section) => (
                  <li key={section.id} className="flex items-center gap-1.5">
                    <Link
                      className="inline-flex rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/u/${slug}/sections/${section.id}`}
                    >
                      {code}-{section.name}
                    </Link>
                    {section.status === 'pending' ? <PendingBadge t={t} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </main>
  );
}
