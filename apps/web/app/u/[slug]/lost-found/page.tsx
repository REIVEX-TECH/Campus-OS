import type { Metadata } from 'next';
import Link from 'next/link';
import { listItems, type BrowseFilters, type ItemKind } from '@campusos/module-lost-found/items';
import { can } from '@campusos/module-identity/rbac';
import { ItemCard } from '@/app/_components/lost-found/item-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { requireLostFound } from '@/lib/lost-found';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type PageProps = Params & { searchParams: Promise<{ kind?: string; after?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('lostFound.heading'),
    path: `${await tenantBase(slug)}/lost-found`,
  });
}

function parseKind(value: string | undefined): ItemKind | undefined {
  return value === 'lost' || value === 'found' ? value : undefined;
}

/** Browse open items, newest first, a page at a time. Filtering by kind. */
export default async function LostFoundPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const query = await searchParams;
  const kind = parseKind(query.kind);
  const actor = await currentActor();
  const isModerator = actor ? await can(actor.userId, slug, 'lostfound.moderate') : false;

  const filters: BrowseFilters = { status: 'open', ...(kind ? { kind } : {}) };
  const { items, nextCursor } = await listItems(slug, {
    filters,
    cursor: query.after ?? null,
  });

  const tabs: { key: string; label: string; kind?: ItemKind }[] = [
    { key: 'all', label: t('lostFound.filter.all') },
    { key: 'lost', label: t('lostFound.kind.lost'), kind: 'lost' },
    { key: 'found', label: t('lostFound.kind.found'), kind: 'found' },
  ];
  const activeKey = kind ?? 'all';
  const tabHref = (tabKind?: ItemKind) => `${base}/lost-found${tabKind ? `?kind=${tabKind}` : ''}`;

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3 px-1">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t('lostFound.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('lostFound.intro')}</p>
      </div>
      <div className="flex items-center gap-3">
        {isModerator ? (
          <Link href={`${base}/lost-found/mod`} className="text-sm font-medium text-primary">
            {t('lostFound.mod.link')}
          </Link>
        ) : null}
        <Link href={`${base}/lost-found/mine`} className="text-sm font-medium text-primary">
          {t('lostFound.mine')}
        </Link>
        <Link
          href={`${base}/lost-found/post`}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {t('lostFound.report')}
        </Link>
      </div>
    </header>
  );

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        {header}
        <nav className="flex flex-wrap gap-2 px-1" aria-label={t('lostFound.heading')}>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tabHref(tab.kind)}
              aria-current={activeKey === tab.key ? 'page' : undefined}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                activeKey === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <EmptyState title={t('lostFound.empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} base={base} t={t} />
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <div className="px-1">
            <Link
              href={`${tabHref(kind)}${kind ? '&' : '?'}after=${encodeURIComponent(nextCursor)}`}
              className="text-sm font-medium text-primary"
            >
              {t('lostFound.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
