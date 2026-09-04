import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listHiddenPosts } from '@campusos/module-communities/saved';
import { UnhideButton } from '@/app/_components/communities/unhide-button';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { requireCommunities } from '@/lib/communities';
import { postPath } from '@/lib/community-constants';
import { communityErrors } from '@/lib/community-labels';
import { relativeTime } from '@/lib/format';
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
    title: translator(tenant.locale)('hidden.heading'),
    path: `${await tenantBase(slug)}/hidden`,
    noIndex: true,
  });
}

/** What a person hid from their feeds, with a way to bring each back. Their own list. */
export default async function HiddenPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const posts = await listHiddenPosts(actor, slug);

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('hidden.heading')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('hidden.intro')}</p>
        </header>
        {posts.length === 0 ? (
          <EmptyState title={t('hidden.empty')} />
        ) : (
          <ul className="ios-card flex flex-col rounded-2xl p-2">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={postPath(base, p.community.slug, p.id, p.title)}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {p.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {p.community.name} · {relativeTime(p.createdAt.toISOString(), tenant.locale)}
                  </span>
                </div>
                <UnhideButton
                  tenant={slug}
                  postId={p.id}
                  labels={{ unhide: t('posts.unhide'), errors: communityErrors(t) }}
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
