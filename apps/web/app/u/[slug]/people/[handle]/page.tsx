import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { myAnonymousPosts, postsByAuthor } from '@campusos/module-communities/posts';
import {
  ownKarma,
  publicKarma,
  type Karma,
  type OwnKarma,
} from '@campusos/module-communities/karma';
import {
  commentsByAuthor,
  isBlocked,
  profileByHandle,
} from '@campusos/module-communities/profiles';
import { BlockButton } from '@/app/_components/communities/block-button';
import { ReportPerson } from '@/app/_components/communities/report-person';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { communityErrors, reportReasonLabels } from '@/lib/community-labels';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; handle: string }> };
type PageProps = Params & { searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, handle } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const profile = await profileByHandle(slug, handle);
  if (!profile) return {};
  return pageMetadata({
    tenant,
    title: profile.handle,
    path: `${await tenantBase(slug)}/people/${profile.handle}`,
    noIndex: true,
  });
}

/**
 * A person as the campus sees them: the handle, what they wrote under it, and
 * a modest karma when the tenant shows it. Nothing anonymous is here, by the
 * column it is keyed on; the person themselves get a private list of what
 * they posted anonymously, on their own page only.
 */
export default async function ProfilePage({ params, searchParams }: PageProps) {
  const { slug, handle } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const profile = await profileByHandle(slug, handle);
  if (!profile) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);
  if (settings.readAccess === 'signedIn' && !actor) {
    return (
      <PageShell>
        <EmptyState title={t('communities.signInToRead')}>
          <Link href={`${base}/signin`} className="font-medium text-primary hover:underline">
            {t('communities.signIn')}
          </Link>
        </EmptyState>
      </PageShell>
    );
  }
  const self = actor?.userId === profile.userId;
  const { tab: tabParam } = await searchParams;
  const tab =
    tabParam === 'comments' ? 'comments' : tabParam === 'anonymous' && self ? 'anonymous' : 'posts';
  // Their own page shows what they wrote anonymously too; anyone else's shows
  // only the signed half, which is the whole point of keeping two.
  const karmaPromise: Promise<Karma | OwnKarma | null> = !settings.karmaVisible
    ? Promise.resolve(null)
    : self && actor
      ? ownKarma(actor, slug)
      : publicKarma(slug, profile.userId);
  const [posts, comments, karma, blocked, anonymous] = await Promise.all([
    tab === 'posts' ? postsByAuthor(slug, profile.userId) : Promise.resolve([]),
    tab === 'comments' ? commentsByAuthor(slug, profile.userId) : Promise.resolve([]),
    karmaPromise,
    actor && !self ? isBlocked(actor, slug, profile.userId) : Promise.resolve(false),
    tab === 'anonymous' && actor ? myAnonymousPosts(actor, slug) : Promise.resolve([]),
  ]);
  const here = `${base}/people/${profile.handle}`;
  const tabs = ['posts', 'comments', ...(self ? (['anonymous'] as const) : [])] as const;

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-center gap-4 px-1">
          <IdentityAvatar seed={profile.avatarSeed} label={profile.handle} size={64} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
            <h1 className="truncate text-2xl font-bold tracking-tight">{profile.handle}</h1>
            {karma ? (
              <p className="text-sm text-muted-foreground">
                {t('profile.karma', { count: karma.total })}
              </p>
            ) : null}
            {karma && 'publicTotal' in karma && karma.total !== karma.publicTotal ? (
              <p className="text-xs text-muted-foreground">
                {t('profile.karmaPrivate', { count: karma.total - karma.publicTotal })}
              </p>
            ) : null}
          </div>
          {actor && !self ? (
            <BlockButton
              tenant={slug}
              userId={profile.userId}
              blocked={blocked}
              labels={{
                block: t('posts.block', { handle: profile.handle }),
                unblock: t('blocked.unblock'),
                done: t('posts.blocked'),
                errors: communityErrors(t),
              }}
              className="ios-pressable inline-flex h-9 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            />
          ) : null}
          {actor && !self ? (
            <ReportPerson
              tenant={slug}
              userId={profile.userId}
              labels={{
                report: t('people.report'),
                heading: t('people.reportHeading'),
                reasons: reportReasonLabels(t),
                note: t('people.reportNote'),
                send: t('people.reportSend'),
                cancel: t('comments.cancel'),
                sent: t('people.reportSent'),
                errors: communityErrors(t),
              }}
              className="ios-pressable inline-flex h-9 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            />
          ) : null}
        </header>

        <nav aria-label={t('profile.tabsLabel')} className="flex flex-wrap gap-1 px-1">
          {tabs.map((k) => (
            <Link
              key={k}
              href={k === 'posts' ? here : `${here}?tab=${k}`}
              aria-current={k === tab ? 'page' : undefined}
              className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
                k === tab
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {k === 'posts'
                ? t('profile.posts')
                : k === 'comments'
                  ? t('profile.comments')
                  : t('profile.anonymous')}
            </Link>
          ))}
        </nav>

        {tab === 'comments' ? (
          comments.length === 0 ? (
            <EmptyState title={t('profile.noComments')} />
          ) : (
            <ol className="ios-card flex flex-col rounded-2xl p-2">
              {comments.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${postPath(base, c.communitySlug, c.postId, c.postTitle)}#comments`}
                    className="ios-pressable flex flex-col gap-0.5 rounded-xl px-2 py-2 hover:bg-muted"
                  >
                    <span className="text-sm">{c.removedAt ? t('comments.removed') : c.body}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.postTitle} · {c.communityName} ·{' '}
                      {relativeTime(c.createdAt.toISOString(), tenant.locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )
        ) : (
          (() => {
            const list = tab === 'anonymous' ? anonymous : posts;
            return list.length === 0 ? (
              <EmptyState
                title={tab === 'anonymous' ? t('profile.noAnonymous') : t('profile.noPosts')}
              />
            ) : (
              <>
                {tab === 'anonymous' ? (
                  <p className="px-1 text-xs text-muted-foreground">{t('profile.anonymousNote')}</p>
                ) : null}
                <ul className="flex flex-col gap-2">
                  {list.map((post) => (
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
              </>
            );
          })()
        )}
      </div>
    </PageShell>
  );
}
