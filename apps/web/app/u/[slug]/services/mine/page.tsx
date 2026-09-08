import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { mediaUrl } from '@campusos/media';
import { myGigs } from '@campusos/module-marketplace/services-read';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { requireMarketplaceServices, serviceCategoryLabel } from '@/lib/marketplace';
import { formatPkr } from '@/lib/money';
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
    title: translator(tenant.locale)('marketplace.services.mineHeading'),
    path: `${await tenantBase(slug)}/services/mine`,
    noIndex: true,
  });
}

export default async function MyGigsPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const gigs = await myGigs(actor.userId, slug);
  const statusLabel: Record<string, string> = {
    active: t('marketplace.gig.status.active'),
    paused: t('marketplace.gig.status.paused'),
    removed: t('marketplace.gig.status.removed'),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('marketplace.services.mineHeading')}
          </h1>
          <Link
            href={`${base}/services/new`}
            className="ios-pressable inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {t('marketplace.services.offer')}
          </Link>
        </header>

        {gigs.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.services.mineEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {gigs.map((gig) => (
              <li key={gig.id}>
                <Link
                  href={`${base}/services/${gig.id}`}
                  className="ios-card ios-pressable flex items-center gap-3 rounded-2xl p-3 hover:bg-muted"
                >
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {gig.coverThumbKey ? (
                      <img
                        src={mediaUrl(gig.coverThumbKey)}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{gig.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {serviceCategoryLabel(t, gig.category)}
                      {gig.fromPricePaisa !== null
                        ? ` · ${t('marketplace.gig.from')} ${formatPkr(gig.fromPricePaisa)}`
                        : ''}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {statusLabel[gig.status] ?? gig.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link href={`${base}/services`} className="px-1 text-sm font-medium text-primary">
          {t('marketplace.back')}
        </Link>
      </div>
    </PageShell>
  );
}
