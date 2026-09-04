import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { searchCommunities, searchPosts } from '@campusos/module-communities/search';
import { CommunityCard } from '@/app/_components/communities/community-card';
import { PostCard } from '@/app/_components/communities/post-card';
import { currentActor } from '@/lib/auth';
import { communitiesEnabled, communitiesSettings } from '@/lib/communities';
import { getTenantRegistry } from '@/lib/tenants';
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
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
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
  const tenant = await requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const q = (sp.q ?? '').trim();
  const active = q.length >= 2;
  // Communities join the search where the module is on; posts only for those who may read them.
  const withCommunities = communitiesEnabled(tenant);
  const actor = withCommunities ? await currentActor() : null;
  const mayReadPosts =
    withCommunities && (communitiesSettings(tenant).readAccess === 'public' || actor !== null);
  const [teachers, courses, foundCommunities, foundPosts] = active
    ? await Promise.all([
        queries.searchTeachers(q),
        queries.searchCourses(q),
        withCommunities ? searchCommunities(slug, q) : Promise.resolve([]),
        mayReadPosts ? searchPosts(actor, slug, q) : Promise.resolve([]),
      ])
    : [[], [], [], []];
  const empty =
    active &&
    teachers.length === 0 &&
    courses.length === 0 &&
    foundCommunities.length === 0 &&
    foundPosts.length === 0;

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
          {foundCommunities.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('search.communities')}
              </h2>
              <ul className="flex flex-col gap-2">
                {foundCommunities.map((c) => (
                  <CommunityCard key={c.id} community={c} href={`${base}/c/${c.slug}`} t={t} />
                ))}
              </ul>
            </section>
          ) : null}

          {foundPosts.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('search.posts')}
              </h2>
              <ul className="flex flex-col gap-2">
                {foundPosts.map((post) => (
                  <li key={post.id}>
                    <PostCard
                      post={post}
                      community={post.community}
                      base={base}
                      tenant={slug}
                      locale={tenant.locale}
                      signedIn={actor !== null}
                      canVote={actor !== null}
                      t={t}
                    />
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
