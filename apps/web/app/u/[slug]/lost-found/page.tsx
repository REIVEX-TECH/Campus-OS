import type { Metadata } from 'next';
import Link from 'next/link';
import { listItems, type BrowseFilters, type ItemKind } from '@campusos/module-lost-found/items';
import { can } from '@campusos/module-identity/rbac';
import { ItemCard } from '@/app/_components/lost-found/item-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { categoryLabel, lostFoundSettings, requireLostFound } from '@/lib/lost-found';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Query = { kind?: string; cat?: string; status?: string; q?: string; after?: string };
type PageProps = Params & { searchParams: Promise<Query> };

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

/** Browse items with kind, status, category and text filters, a page at a time. */
export default async function LostFoundPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const query = await searchParams;
  const kind = parseKind(query.kind);
  const status: 'open' | 'resolved' = query.status === 'resolved' ? 'resolved' : 'open';
  const category = query.cat?.trim() || undefined;
  const search = query.q?.trim() || undefined;
  const settings = lostFoundSettings(tenant);
  const actor = await currentActor();
  const isModerator = actor ? await can(actor.userId, slug, 'lostfound.moderate') : false;

  const filters: BrowseFilters = {
    status,
    ...(kind ? { kind } : {}),
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
  };
  const { items, nextCursor } = await listItems(slug, { filters, cursor: query.after ?? null });

  // A link to this page carrying the active filters, plus overrides.
  const href = (over: Partial<Query>) => {
    const p = new URLSearchParams();
    const merged: Query = { kind: query.kind, cat: category, status, q: search, ...over };
    if (merged.kind === 'lost' || merged.kind === 'found') p.set('kind', merged.kind);
    if (merged.cat) p.set('cat', merged.cat);
    if (merged.status === 'resolved') p.set('status', 'resolved');
    if (merged.q) p.set('q', merged.q);
    if (merged.after) p.set('after', merged.after);
    const qs = p.toString();
    return `${base}/lost-found${qs ? `?${qs}` : ''}`;
  };

  const kindTabs: { key: string; label: string; kind?: ItemKind }[] = [
    { key: 'all', label: t('lostFound.filter.all') },
    { key: 'lost', label: t('lostFound.kind.lost'), kind: 'lost' },
    { key: 'found', label: t('lostFound.kind.found'), kind: 'found' },
  ];
  const statusTabs: ('open' | 'resolved')[] = ['open', 'resolved'];
  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
    }`;

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
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
              className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t('lostFound.post')}
            </Link>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-2 px-1" aria-label={t('lostFound.heading')}>
          {kindTabs.map((tab) => (
            <Link
              key={tab.key}
              href={href({ kind: tab.kind ?? '', after: undefined })}
              aria-current={(kind ?? 'all') === tab.key ? 'page' : undefined}
              className={pill((kind ?? 'all') === tab.key)}
            >
              {tab.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-muted" aria-hidden />
          {statusTabs.map((s) => (
            <Link
              key={s}
              href={href({ status: s, after: undefined })}
              aria-current={status === s ? 'page' : undefined}
              className={pill(status === s)}
            >
              {t(`lostFound.filter.${s}`)}
            </Link>
          ))}
        </nav>

        <form method="get" className="flex flex-wrap gap-2 px-1">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {status === 'resolved' ? <input type="hidden" name="status" value="resolved" /> : null}
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder={t('lostFound.searchPlaceholder')}
            className="ios-field flex-1"
            aria-label={t('lostFound.searchPlaceholder')}
          />
          <select
            name="cat"
            defaultValue={category ?? ''}
            className="ios-field"
            aria-label={t('lostFound.form.category')}
          >
            <option value="">{t('lostFound.filter.all')}</option>
            {settings.categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold">
            {t('search.heading')}
          </button>
        </form>

        {items.length === 0 ? (
          <EmptyState
            title={status === 'resolved' ? t('lostFound.emptyResolved') : t('lostFound.empty')}
          />
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
            <Link href={href({ after: nextCursor })} className="text-sm font-medium text-primary">
              {t('lostFound.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
