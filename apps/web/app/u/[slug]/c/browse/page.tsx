import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { myCommunities } from '@campusos/module-communities/communities';
import { listCommunities, type DirectoryOrder } from '@campusos/module-communities/directory';
import { searchCommunities, searchPosts } from '@campusos/module-communities/search';
import { CommunityCard } from '@/app/_components/communities/community-card';
import { PlatformRules } from '@/app/_components/communities/community-rail';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & { searchParams: Promise<{ q?: string; sort?: string }> };
const ORDERS: DirectoryOrder[] = ['members', 'new', 'name'];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('feeds.browse'),
    path: `${await tenantBase(slug)}/c/browse`,
  });
}

/**
 * The directory: search across communities and posts, or browse every
 * community by size, age or name, with the ones a person joined on top.
 */
export default async function BrowseCommunitiesPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);
  const query = await searchParams;
  const q = (query.q ?? '').trim();
  const sort: DirectoryOrder = ORDERS.includes(query.sort as DirectoryOrder)
    ? (query.sort as DirectoryOrder)
    : 'members';

  if (settings.readAccess === 'signedIn' && !actor) {
    return (
      <PageShell rail={<PlatformRules t={t} />}>
        <EmptyState title={t('communities.signInToRead')}>
          <Link href={`${base}/signin`} className="font-medium text-primary hover:underline">
            {t('communities.signIn')}
          </Link>
        </EmptyState>
      </PageShell>
    );
  }

  const searching = q.length >= 2;
  const [all, mine, foundCommunities, foundPosts] = await Promise.all([
    searching ? Promise.resolve([]) : listCommunities(slug, 100, sort),
    actor ? myCommunities(actor, slug) : Promise.resolve([]),
    searching ? searchCommunities(slug, q) : Promise.resolve([]),
    searching ? searchPosts(actor, slug, q) : Promise.resolve([]),
  ]);
  const sortHref = (o: DirectoryOrder) => `${base}/c/browse${o === 'members' ? '' : `?sort=${o}`}`;

  return (
    <PageShell rail={<PlatformRules t={t} />}>
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t('feeds.browse')}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/c`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              {t('feeds.backToFeed')}
            </Link>
            {actor ? (
              <Link href={`${base}/c/new`} className={buttonVariants({ size: 'sm' })}>
                {t('communities.new')}
              </Link>
            ) : null}
          </div>
        </header>

        <form role="search" action={`${base}/c/browse`} className="flex gap-2 px-1">
          <label className="sr-only" htmlFor="directory-q">
            {t('feeds.searchCommunities')}
          </label>
          <input
            id="directory-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t('feeds.searchCommunities')}
            autoComplete="off"
            className="ios-field h-10 flex-1 rounded-xl px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="submit" className={buttonVariants({ size: 'sm' })}>
            {t('search.heading')}
          </button>
        </form>

        {searching ? (
          foundCommunities.length === 0 && foundPosts.length === 0 ? (
            <EmptyState title={t('feeds.noResults', { q })} />
          ) : (
            <>
              {foundCommunities.length > 0 ? (
                <section aria-labelledby="results-communities" className="flex flex-col gap-2">
                  <h2
                    id="results-communities"
                    className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  >
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
                <section aria-labelledby="results-posts" className="flex flex-col gap-2">
                  <h2
                    id="results-posts"
                    className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  >
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
            </>
          )
        ) : (
          <>
            {actor ? (
              <section aria-labelledby="communities-yours" className="flex flex-col gap-2">
                <h2
                  id="communities-yours"
                  className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t('communities.yours')}
                </h2>
                {mine.length === 0 ? (
                  <p className="px-1 text-sm text-muted-foreground">
                    {t('communities.yoursEmpty')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {mine.map((c) => (
                      <CommunityCard key={c.id} community={c} href={`${base}/c/${c.slug}`} t={t} />
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section aria-labelledby="communities-all" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <h2
                  id="communities-all"
                  className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t('communities.all')}
                </h2>
                <nav aria-label={t('feeds.sortLabel')} className="flex gap-1">
                  {ORDERS.map((o) => (
                    <Link
                      key={o}
                      href={sortHref(o)}
                      aria-current={o === sort ? 'page' : undefined}
                      className={`ios-pressable rounded-lg px-2.5 py-1 text-xs font-medium ${
                        o === sort
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t(`feeds.directory.${o}` as MessageKey)}
                    </Link>
                  ))}
                </nav>
              </div>
              {all.length === 0 ? (
                <EmptyState title={t('communities.empty')} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {all.map((c) => (
                    <CommunityCard key={c.id} community={c} href={`${base}/c/${c.slug}`} t={t} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
