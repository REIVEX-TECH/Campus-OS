import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { tenantRegistry } from '@campusos/tenants';
import { EmptyState } from '@/app/_components/empty-state';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('search.heading'),
    path: `${await tenantBase(slug)}/search`,
  });
}

export default async function SearchPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const q = (sp.q ?? '').trim();
  const active = q.length >= 2;
  const [teachers, courses] = active
    ? await Promise.all([queries.searchTeachers(q), queries.searchCourses(q)])
    : [[], []];
  const empty = active && teachers.length === 0 && courses.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 px-1">
        <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('search.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('search.intro')}</p>
      </header>

      {!active ? (
        <p className="px-1 text-sm text-muted-foreground">{t('search.prompt')}</p>
      ) : empty ? (
        <EmptyState title={t('search.none', { q })} icon={SearchX} />
      ) : (
        <div className="flex flex-col gap-6">
          {teachers.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('search.teachers')}
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {teachers.map((tr) => (
                  <li key={tr.id}>
                    <Link
                      href={`${base}/teachers/${tr.id}`}
                      className="ios-card ios-pressable block rounded-2xl p-4 font-semibold hover:shadow-[var(--shadow-card-strong)]"
                    >
                      {tr.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {courses.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('search.courses')}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`${base}/courses/${c.id}`}
                      className="ios-card ios-pressable flex flex-col gap-0.5 rounded-2xl p-4 hover:shadow-[var(--shadow-card-strong)]"
                    >
                      <span className="font-semibold">{c.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
