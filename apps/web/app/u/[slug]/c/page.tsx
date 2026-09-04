import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { myCommunities } from '@campusos/module-communities/communities';
import { flairsByIds } from '@campusos/module-communities/flairs';
import {
  isFeedSort,
  isTopWindow,
  listPosts,
  trendingPosts,
  type FeedSort,
  type TopWindow,
} from '@campusos/module-communities/feed';
import { PlatformRules } from '@/app/_components/communities/community-rail';
import { CommunityIcon } from '@/app/_components/communities/community-visuals';
import { FeedTabs } from '@/app/_components/communities/feed-tabs';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & {
  searchParams: Promise<{ feed?: string; sort?: string; t?: string; after?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('communities.heading'),
    path: `${await tenantBase(slug)}/c`,
  });
}

/**
 * The feeds: Home (the communities a person joined) and All (everything
 * public in the university), in five sorts, a page at a time. The rail keeps a
 * person's communities, what is rising, and the rules every community shares.
 */
export default async function CommunitiesPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);
  const query = await searchParams;

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3 px-1">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('communities.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t('communities.intro', { name: tenant.displayName })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`${base}/c/browse`}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {t('feeds.browse')}
        </Link>
        {actor ? (
          <Link href={`${base}/c/new`} className={buttonVariants({ size: 'sm' })}>
            {t('communities.new')}
          </Link>
        ) : null}
      </div>
    </header>
  );

  if (settings.readAccess === 'signedIn' && !actor) {
    return (
      <PageShell rail={<PlatformRules t={t} />}>
        <div className="flex flex-col gap-5">
          {header}
          <EmptyState title={t('communities.signInToRead')}>
            <Link href={`${base}/signin`} className="font-medium text-primary hover:underline">
              {t('communities.signIn')}
            </Link>
          </EmptyState>
        </div>
      </PageShell>
    );
  }

  const feed: 'home' | 'all' = query.feed === 'all' || !actor ? 'all' : 'home';
  const sort: FeedSort = isFeedSort(query.sort) ? query.sort : 'hot';
  const window: TopWindow = isTopWindow(query.t) ? query.t : 'day';
  const [page, mine, trending] = await Promise.all([
    listPosts(actor, slug, feed === 'home' ? { kind: 'home' } : { kind: 'all' }, {
      sort,
      window,
      cursor: query.after,
    }),
    actor ? myCommunities(actor, slug) : Promise.resolve([]),
    trendingPosts(actor, slug, 5),
  ]);
  const flairs = [
    ...(
      await flairsByIds(
        slug,
        page.items.map((p) => p.flairId).filter((x): x is string => x !== null),
      )
    ).values(),
  ];
  const href = (patch: Partial<{ feed: string; sort: string; t: string; after: string }>) => {
    const p = new URLSearchParams();
    const next = { feed, sort, t: window, ...patch };
    if (next.feed !== (actor ? 'home' : 'all')) p.set('feed', next.feed);
    if (next.sort !== 'hot') p.set('sort', next.sort);
    if (next.sort === 'top' && next.t !== 'day') p.set('t', next.t);
    if (next.after) p.set('after', next.after);
    const s = p.toString();
    return `${base}/c${s ? `?${s}` : ''}`;
  };

  const rail = (
    <>
      {actor ? (
        <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
          <h2 className="text-sm font-semibold">{t('communities.yours')}</h2>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('communities.yoursEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {mine.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${base}/c/${c.slug}`}
                    className="flex items-center gap-2 text-sm font-medium hover:underline"
                  >
                    <CommunityIcon seed={c.iconSeed} name={c.name} size={22} />
                    <span className="truncate">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {trending.length > 0 ? (
        <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
          <h2 className="text-sm font-semibold">{t('feeds.trending')}</h2>
          <ol className="flex flex-col gap-2">
            {trending.map((p) => (
              <li key={p.id} className="flex flex-col">
                <Link
                  href={postPath(base, p.community.slug, p.id, p.title)}
                  className="line-clamp-2 text-sm font-medium hover:underline"
                >
                  {p.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {p.community.name} · {t('posts.score', { count: p.score })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <PlatformRules t={t} />
    </>
  );

  return (
    <PageShell rail={rail}>
      <div className="flex flex-col gap-4">
        {header}
        <FeedTabs
          feeds={actor ? ['home', 'all'] : ['all']}
          feed={feed}
          sort={sort}
          window={window}
          hrefFor={(patch) => href(patch)}
          t={t}
        />
        {page.items.length === 0 ? (
          <EmptyState title={feed === 'home' ? t('feeds.empty.home') : t('feeds.empty.all')}>
            {feed === 'home' ? (
              <Link href={`${base}/c/browse`} className="font-medium text-primary hover:underline">
                {t('feeds.browse')}
              </Link>
            ) : null}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((post) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  community={post.community}
                  base={base}
                  tenant={slug}
                  locale={tenant.locale}
                  signedIn={actor !== null}
                  canVote={actor !== null}
                  flairs={flairs}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor ? (
          <div className="px-1">
            <Link
              href={href({ after: page.nextCursor })}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {t('posts.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
