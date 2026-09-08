import type { Metadata } from 'next';
import Link from 'next/link';
import { listGigs } from '@campusos/module-marketplace/services-read';
import { GigCard } from '@/app/_components/marketplace/gig-card';
import { PageShell } from '@/app/_components/page-shell';
import { translator } from '@/lib/i18n';
import {
  marketplaceSettings,
  requireMarketplaceServices,
  serviceCategoryLabels,
} from '@/lib/marketplace';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.services.heading'),
    path: `${await tenantBase(slug)}/services`,
  });
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function ServicesPage({ params, searchParams }: Params & Search) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const settings = marketplaceSettings(tenant);

  const q = one(sp.q);
  const category = one(sp.category);
  const cursor = one(sp.cursor) || null;
  const { items, nextCursor } = await listGigs(slug, {
    category: category || undefined,
    search: q || undefined,
    cursor,
  });

  const cardLabels = {
    from: t('marketplace.gig.from'),
    categoryLabels: serviceCategoryLabels(t, settings.serviceCategories),
  };

  const more = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, category })) if (v) more.set(k, v);
  if (nextCursor) more.set('cursor', nextCursor);

  const control =
    'ios-field h-10 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('marketplace.services.heading')}
            </h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t('marketplace.services.intro')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`${base}/services/mine`}
              className="ios-pressable inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t('marketplace.services.mine')}
            </Link>
            <Link
              href={`${base}/services/new`}
              className="ios-pressable inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t('marketplace.services.offer')}
            </Link>
          </div>
        </header>

        <form method="get" className="flex flex-wrap gap-2 px-1">
          <input
            name="q"
            defaultValue={q}
            placeholder={t('marketplace.services.searchPlaceholder')}
            className={`${control} flex-1`}
          />
          <select name="category" defaultValue={category} className={control}>
            <option value="">{t('marketplace.browse.allCategories')}</option>
            {settings.serviceCategories.map((c) => (
              <option key={c} value={c}>
                {cardLabels.categoryLabels[c] ?? c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="ios-pressable rounded-xl bg-muted px-4 text-sm font-medium text-muted-foreground"
          >
            {t('marketplace.browse.apply')}
          </button>
        </form>

        {items.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.services.empty')}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((gig) => (
              <li key={gig.id}>
                <GigCard gig={gig} base={base} labels={cardLabels} />
              </li>
            ))}
          </ul>
        )}

        {nextCursor ? (
          <div className="flex justify-center">
            <Link
              href={`${base}/services?${more.toString()}`}
              className="ios-pressable rounded-xl px-4 py-2 text-sm font-medium text-primary hover:bg-muted"
            >
              {t('marketplace.browse.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
