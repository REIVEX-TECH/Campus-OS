import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listSavedComments, listSavedPosts } from '@campusos/module-communities/saved';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & { searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('posts.saved.heading'),
    path: `${await tenantBase(slug)}/saved`,
    noIndex: true,
  });
}

/** What a person kept: posts and comments, their own list, newest saved first. */
export default async function SavedPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const t = translator(tenant.locale);
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === 'comments' ? 'comments' : 'posts';
  const [posts, comments] = await Promise.all([
    tab === 'posts' ? listSavedPosts(actor, slug) : Promise.resolve([]),
    tab === 'comments' ? listSavedComments(actor, slug) : Promise.resolve([]),
  ]);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('posts.saved.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('posts.saved.intro')}</p>
        </header>
        <nav aria-label={t('saved.tabsLabel')} className="flex gap-1 px-1">
          {(['posts', 'comments'] as const).map((k) => (
            <Link
              key={k}
              href={k === 'posts' ? `${base}/saved` : `${base}/saved?tab=comments`}
              aria-current={k === tab ? 'page' : undefined}
              className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
                k === tab
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {k === 'posts' ? t('saved.posts') : t('saved.comments')}
            </Link>
          ))}
        </nav>
        {tab === 'comments' ? (
          comments.length === 0 ? (
            <EmptyState title={t('saved.noComments')} />
          ) : (
            <ol className="ios-card flex flex-col rounded-2xl p-2">
              {comments.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${postPath(base, c.communitySlug, c.postId, c.postTitle)}#comments`}
                    className="ios-pressable flex flex-col gap-0.5 rounded-xl px-2 py-2 hover:bg-muted"
                  >
                    <span className="text-sm">{c.body || t('comments.removed')}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.postTitle} · {c.communityName} ·{' '}
                      {relativeTime(c.createdAt.toISOString(), tenant.locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )
        ) : posts.length === 0 ? (
          <EmptyState title={t('posts.saved.empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  community={post.community}
                  base={base}
                  tenant={slug}
                  locale={tenant.locale}
                  signedIn
                  canVote
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="px-1 text-sm">
          <Link href={`${base}/c`} className="font-medium text-primary hover:underline">
            {t('communities.back')}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
