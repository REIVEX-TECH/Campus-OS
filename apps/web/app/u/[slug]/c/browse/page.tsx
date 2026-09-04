import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { myCommunities } from '@campusos/module-communities/communities';
import { listCommunities } from '@campusos/module-communities/directory';
import { CommunityCard } from '@/app/_components/communities/community-card';
import { PlatformRules } from '@/app/_components/communities/community-rail';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { communitiesSettings, requireCommunities } from '@/lib/communities';
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
    title: translator(tenant.locale)('feeds.browse'),
    path: `${await tenantBase(slug)}/c/browse`,
  });
}

/** Every community, and the ones a person joined. Discovery proper (search) is B3. */
export default async function BrowseCommunitiesPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireCommunities(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  const settings = communitiesSettings(tenant);

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

  const [all, mine] = await Promise.all([
    listCommunities(slug),
    actor ? myCommunities(actor, slug) : Promise.resolve([]),
  ]);

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

        {actor ? (
          <section aria-labelledby="communities-yours" className="flex flex-col gap-2">
            <h2
              id="communities-yours"
              className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t('communities.yours')}
            </h2>
            {mine.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{t('communities.yoursEmpty')}</p>
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
          <h2
            id="communities-all"
            className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t('communities.all')}
          </h2>
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
      </div>
    </PageShell>
  );
}
