import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { mediaUrl } from '@campusos/media';
import { myListings } from '@campusos/module-marketplace/listings';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { requireMarketplace } from '@/lib/marketplace';
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
    title: translator(tenant.locale)('marketplace.mine.heading'),
    path: `${await tenantBase(slug)}/marketplace/mine`,
  });
}

export default async function MyListingsPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const listings = await myListings(actor.userId, slug);

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.mine.heading')}</h1>
          <Link
            href={`${base}/marketplace/post`}
            className="ios-pressable inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {t('marketplace.sell')}
          </Link>
        </header>

        {listings.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.mine.empty')}
          </p>
        ) : (
          <ul className="ios-card flex flex-col divide-y divide-border rounded-2xl">
            {listings.map((l) => (
              <li key={l.id}>
                <Link
                  href={`${base}/marketplace/${l.id}`}
                  className="ios-pressable flex items-center gap-3 p-3"
                >
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {l.thumbKey ? (
                      <img
                        src={mediaUrl(l.thumbKey)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{l.title}</span>
                    <span className="text-sm">
                      {l.pricePaisa === 0 ? t('marketplace.price.free') : formatPkr(l.pricePaisa)}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t(`marketplace.status.${l.status}` as MessageKey)}</span>
                      {l.expiringSoon ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                          {t('marketplace.mine.expiringSoon')}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-primary">
                    {t('marketplace.mine.manage')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
