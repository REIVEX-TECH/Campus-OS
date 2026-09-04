import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { communityBySlug } from '@campusos/module-communities/communities';
import { postById, postHistory } from '@campusos/module-communities/posts';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; community: string; postId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('posts.history.heading'),
    path: `${await tenantBase(slug)}/c`,
    noIndex: true,
  });
}

/** What a post said before each edit. No author, ever: an edit is not a signature. */
export default async function PostHistoryPage({ params }: Params) {
  const { slug, community: communitySlug, postId } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const community = await communityBySlug(slug, communitySlug);
  if (!community) notFound();
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (communitiesSettings(tenant).readAccess === 'signedIn' && !actor) {
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
  const post = await postById(actor, slug, postId);
  if (!post || post.communityId !== community.id || post.deletedAt) notFound();
  const history = await postHistory(slug, post.id);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{community.name}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('posts.history.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('posts.history.intro')}</p>
        </header>
        {history.length === 0 ? (
          <EmptyState title={t('posts.history.none')} />
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((h, i) => (
              <li key={i} className="ios-card flex flex-col gap-1 rounded-2xl p-4">
                <p className="text-xs text-muted-foreground">
                  {t('posts.history.at', {
                    when: relativeTime(h.editedAt.toISOString(), tenant.locale),
                  })}
                </p>
                <p className="text-base font-semibold">{h.previousTitle}</p>
                {h.previousBody ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {h.previousBody}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <p className="px-1 text-sm">
          <Link
            href={postPath(base, community.slug, post.id, post.title)}
            className="font-medium text-primary hover:underline"
          >
            {post.title}
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
