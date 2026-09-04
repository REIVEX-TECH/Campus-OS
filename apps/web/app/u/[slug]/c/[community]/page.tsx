import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { communityBySlug, permissionsIn } from '@campusos/module-communities/communities';
import { membershipState } from '@campusos/module-communities/directory';
import {
  isFeedSort,
  isTopWindow,
  listCommunityPosts,
  type FeedSort,
  type TopWindow,
} from '@campusos/module-communities/feed';
import { listFlairs } from '@campusos/module-communities/flairs';
import { listModerators } from '@campusos/module-communities/members';
import { listRules } from '@campusos/module-communities/rules';
import { buttonVariants } from '@campusos/ui';
import { CommunityRail } from '@/app/_components/communities/community-rail';
import { FeedTabs } from '@/app/_components/communities/feed-tabs';
import { PostCard } from '@/app/_components/communities/post-card';
import { CommunityBanner, CommunityIcon } from '@/app/_components/communities/community-visuals';
import { JoinButton } from '@/app/_components/communities/join-button';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { communityErrors } from '@/lib/community-labels';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string }> };
type PageProps = Params & {
  searchParams: Promise<{ after?: string; sort?: string; t?: string; flair?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, community } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant || !tenant.enabledModules.includes('communities')) return {};
  const c = await communityBySlug(slug, community);
  if (!c) return {};
  return pageMetadata({
    tenant,
    title: c.name,
    description: c.description || undefined,
    path: `${await tenantBase(slug)}/c/${c.slug}`,
  });
}

/**
 * One community: what it is, who runs it, its rules, and its posts in any sort.
 * An unknown slug is 404 whoever asks; reading a known one needs a sign in by
 * default, a tenant setting.
 */
export default async function CommunityPage({ params, searchParams }: PageProps) {
  const { slug, community: communitySlug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);

  if (settings.readAccess === 'signedIn' && !actor) {
    return (
      <PageShell>
        <div className="flex flex-col gap-5">
          <CommunityBanner seed={community.bannerSeed} />
          <h1 className="px-1 text-2xl font-bold tracking-tight">{community.name}</h1>
          <EmptyState title={t('communities.signInToRead')}>
            <Link href={`${base}/signin`} className="font-medium text-primary hover:underline">
              {t('communities.signIn')}
            </Link>
          </EmptyState>
        </div>
      </PageShell>
    );
  }

  const [rules, moderators, state, perms, flairs] = await Promise.all([
    listRules(slug, community.id),
    listModerators(slug, community.id),
    actor ? membershipState(actor, slug, community.id) : Promise.resolve(null),
    actor ? permissionsIn(actor, slug, community.id) : Promise.resolve(null),
    listFlairs(slug, community.id),
  ]);
  const canManage = perms?.hasAny('communities.manage', 'communities.oversee') ?? false;
  const query = await searchParams;
  const sort: FeedSort = isFeedSort(query.sort) ? query.sort : 'hot';
  const window: TopWindow = isTopWindow(query.t) ? query.t : 'day';
  const flairId = flairs.some((f) => f.id === query.flair) ? query.flair : undefined;
  const feed = await listCommunityPosts(actor, slug, community.id, {
    sort,
    window,
    cursor: query.after,
    flairId,
  });
  const href = (patch: Partial<{ sort: string; t: string; after: string; flair: string }>) => {
    const p = new URLSearchParams();
    const next = { sort, t: window, flair: flairId ?? '', ...patch };
    if (next.flair) p.set('flair', next.flair);
    if (next.sort !== 'hot') p.set('sort', next.sort);
    if (next.sort === 'top' && next.t !== 'day') p.set('t', next.t);
    if (next.after) p.set('after', next.after);
    const qs = p.toString();
    return `${base}/c/${community.slug}${qs ? `?${qs}` : ''}`;
  };
  const canPost = perms?.has('communities.post') ?? false;
  const canJoin = actor !== null && (community.visibility === 'public' || state?.joined);

  return (
    <PageShell
      rail={
        <CommunityRail
          community={community}
          rules={rules}
          moderators={moderators}
          base={base}
          locale={tenant.locale}
          canManage={canManage}
          canModerate={perms?.hasAny('communities.moderate', 'communities.oversee') ?? false}
          t={t}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <CommunityBanner seed={community.bannerSeed} />
        <header className="-mt-10 flex flex-wrap items-end gap-3 px-3 sm:-mt-12">
          <CommunityIcon
            seed={community.iconSeed}
            name={community.name}
            size={72}
            className="ring-4 ring-background"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{community.name}</h1>
              {community.approvalStatus === 'pending' ? (
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('communities.pending')}
                </span>
              ) : null}
              {community.visibility === 'restricted' ? (
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('communities.restricted')}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {t('communities.members', { count: community.memberCount })}
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {canJoin ? (
              <JoinButton
                tenant={slug}
                communityId={community.id}
                joined={state?.joined ?? false}
                labels={{
                  join: t('communities.join'),
                  leave: t('communities.leave'),
                  working: t('communities.working'),
                  errors: communityErrors(t),
                }}
              />
            ) : null}
          </div>
        </header>
        {community.description ? (
          <p className="max-w-prose px-1 text-sm text-muted-foreground xl:hidden">
            {community.description}
          </p>
        ) : null}

        <section aria-labelledby="community-posts" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2
              id="community-posts"
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t('communities.posts')}
            </h2>
            {canPost ? (
              <Link
                href={`${base}/c/${community.slug}/submit`}
                className={buttonVariants({ size: 'sm' })}
              >
                {t('posts.new')}
              </Link>
            ) : null}
          </div>
          <FeedTabs feeds={[]} sort={sort} window={window} hrefFor={href} t={t} />
          {flairs.length > 0 ? (
            <nav aria-label={t('flairs.label')} className="flex flex-wrap gap-1 px-1">
              <Link
                href={href({ flair: '' })}
                aria-current={flairId ? undefined : 'page'}
                className={`ios-pressable rounded-full px-2.5 py-1 text-xs font-medium ${flairId ? 'text-muted-foreground hover:text-foreground' : 'bg-muted text-foreground'}`}
              >
                {t('flairs.filterAll')}
              </Link>
              {flairs.map((f) => (
                <Link
                  key={f.id}
                  href={href({ flair: f.id })}
                  aria-current={f.id === flairId ? 'page' : undefined}
                  className={`ios-pressable inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${f.id === flairId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                  {f.name}
                </Link>
              ))}
            </nav>
          ) : null}
          {feed.items.length === 0 ? (
            <EmptyState title={t('posts.none')}>{canPost ? t('posts.beFirst') : null}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {feed.items.map((post) => (
                <li key={post.id}>
                  <PostCard
                    post={post}
                    community={{ slug: community.slug, name: community.name }}
                    base={base}
                    tenant={slug}
                    locale={tenant.locale}
                    signedIn={actor !== null}
                    canVote={perms?.has('communities.vote') ?? false}
                    flairs={flairs}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}
          {feed.nextCursor ? (
            <div className="px-1">
              <Link
                href={href({ after: feed.nextCursor })}
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                {t('posts.more')}
              </Link>
            </div>
          ) : null}
        </section>

        <p className="px-1 text-sm">
          <Link href={`${base}/c`} className="font-medium text-primary hover:underline">
            {t('communities.back')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
