import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listSavedPosts } from '@campusos/module-communities/saved';
import { PostCard } from '@/app/_components/communities/post-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { requireCommunities } from '@/lib/communities';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

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

/** The posts you saved. Private: the table shows a person only their own rows. */
export default async function SavedPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const t = translator(tenant.locale);
  const posts = await listSavedPosts(actor, slug);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('posts.saved.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('posts.saved.intro')}</p>
        </header>
        {posts.length === 0 ? (
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
