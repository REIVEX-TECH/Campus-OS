import type { Metadata } from 'next';
import Link from 'next/link';
import { listListings, type ListingSort } from '@campusos/module-marketplace/listings';
import { BrowseControls } from '@/app/_components/marketplace/browse-controls';
import { ListingCard } from '@/app/_components/marketplace/listing-card';
import { PageShell } from '@/app/_components/page-shell';
import { translator } from '@/lib/i18n';
import {
  categoryLabels,
  conditionLabels,
  marketplaceSettings,
  requireMarketplace,
} from '@/lib/marketplace';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';
import { parsePkrToPaisa } from '@/lib/money';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.heading'),
    path: `${await tenantBase(slug)}/marketplace`,
  });
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function MarketplacePage({ params, searchParams }: Params & Search) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const settings = marketplaceSettings(tenant);

  const q = one(sp.q);
  const category = one(sp.category);
  const condition = one(sp.condition);
  const minStr = one(sp.min);
  const maxStr = one(sp.max);
  const sortParam = one(sp.sort);
  const sort: ListingSort =
    sortParam === 'price_asc' || sortParam === 'price_desc' ? sortParam : 'new';
  const cursor = one(sp.cursor) || null;
  const minPaisa = minStr ? parsePkrToPaisa(minStr) : null;
  const maxPaisa = maxStr ? parsePkrToPaisa(maxStr) : null;

  const { items, nextCursor } = await listListings(slug, {
    filters: {
      category: category || undefined,
      condition: condition || undefined,
      priceMinPaisa: minPaisa ?? undefined,
      priceMaxPaisa: maxPaisa ?? undefined,
      search: q || undefined,
    },
    sort,
    cursor,
  });

  const cardLabels = {
    free: t('marketplace.price.free'),
    negotiable: t('marketplace.card.negotiable'),
    conditionLabels: conditionLabels(t),
  };
  const controlLabels = {
    searchPlaceholder: t('marketplace.browse.searchPlaceholder'),
    sort: t('marketplace.browse.sort'),
    sortNew: t('marketplace.browse.sortNew'),
    sortPriceAsc: t('marketplace.browse.sortPriceAsc'),
    sortPriceDesc: t('marketplace.browse.sortPriceDesc'),
    allCategories: t('marketplace.browse.allCategories'),
    allConditions: t('marketplace.browse.allConditions'),
    priceMin: t('marketplace.browse.priceMin'),
    priceMax: t('marketplace.browse.priceMax'),
    apply: t('marketplace.browse.apply'),
    clear: t('marketplace.browse.clear'),
    categoryLabels: categoryLabels(t, settings.categories),
    conditionLabels: conditionLabels(t),
  };

  // Preserve the current filters when following the "load more" cursor link.
  const moreParams = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, category, condition, min: minStr, max: maxStr })) {
    if (v) moreParams.set(k, v);
  }
  if (sort !== 'new') moreParams.set('sort', sort);
  if (nextCursor) moreParams.set('cursor', nextCursor);

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.heading')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t('marketplace.intro')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`${base}/marketplace/mine`}
              className="ios-pressable inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t('marketplace.mine.link')}
            </Link>
            <Link
              href={`${base}/marketplace/post`}
              className="ios-pressable inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t('marketplace.sell')}
            </Link>
          </div>
        </header>

        <BrowseControls
          base={base}
          categories={settings.categories}
          initial={{ q, category, condition, min: minStr, max: maxStr, sort }}
          labels={controlLabels}
        />

        {items.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.empty')}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} base={base} labels={cardLabels} />
              </li>
            ))}
          </ul>
        )}

        {nextCursor ? (
          <div className="flex justify-center">
            <Link
              href={`${base}/marketplace?${moreParams.toString()}`}
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
