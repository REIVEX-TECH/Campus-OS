import type { Metadata } from 'next';
import Link from 'next/link';
import {
  browseRides,
  type BrowseFilters,
  type RideKind,
  type RideSummary,
} from '@campusos/module-rides/posts';
import { RideCard } from '@/app/_components/rides/ride-card';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';
import { requireRides } from '@/lib/rides';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Query = { kind?: string; women?: string; q?: string; day?: string; after?: string };
type PageProps = Params & { searchParams: Promise<Query> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.heading'),
    path: `${await tenantBase(slug)}/rides`,
  });
}

function parseKind(value: string | undefined): RideKind | undefined {
  return value === 'offer' || value === 'request' ? value : undefined;
}

/** yyyy-mm-dd for `when` in the tenant timezone (a stable grouping key). */
function dayKey(when: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(when);
}

export default async function RidesPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const query = await searchParams;
  const kind = parseKind(query.kind);
  const womenOnly = query.women === '1';
  const search = query.q?.trim() || undefined;
  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(query.day ?? '') ? query.day : undefined;
  const actor = await currentActor();

  const filters: BrowseFilters = {
    ...(kind ? { kind } : {}),
    ...(womenOnly ? { womenOnly: true } : {}),
    ...(search ? { search } : {}),
    ...(onDate ? { onDate } : {}),
  };
  const { rides, nextCursor } = await browseRides(slug, {
    filters,
    cursor: query.after ?? null,
    viewerId: actor?.userId ?? null,
  });

  const href = (over: Partial<Query>) => {
    const p = new URLSearchParams();
    const merged: Query = {
      kind: query.kind,
      women: womenOnly ? '1' : '',
      q: search,
      day: onDate,
      ...over,
    };
    if (merged.kind === 'offer' || merged.kind === 'request') p.set('kind', merged.kind);
    if (merged.women === '1') p.set('women', '1');
    if (merged.q) p.set('q', merged.q);
    if (merged.day) p.set('day', merged.day);
    if (merged.after) p.set('after', merged.after);
    const qs = p.toString();
    return `${base}/rides${qs ? `?${qs}` : ''}`;
  };

  // Group the (depart_at asc) rides into consecutive days.
  const todayKey = dayKey(new Date(), tenant.timezone);
  const tomorrowKey = dayKey(new Date(Date.now() + 86_400_000), tenant.timezone);
  const groups: { key: string; label: string; rides: RideSummary[] }[] = [];
  for (const ride of rides) {
    const key = dayKey(ride.departAt, tenant.timezone);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const label =
        key === todayKey
          ? t('rides.day.today')
          : key === tomorrowKey
            ? t('rides.day.tomorrow')
            : new Intl.DateTimeFormat(tenant.locale, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                timeZone: tenant.timezone,
              }).format(ride.departAt);
      group = { key, label, rides: [] };
      groups.push(group);
    }
    group.rides.push(ride);
  }

  const kindTabs: { key: string; label: string; kind?: RideKind }[] = [
    { key: 'all', label: t('rides.filter.all') },
    { key: 'offer', label: t('rides.kind.offer'), kind: 'offer' },
    { key: 'request', label: t('rides.kind.request'), kind: 'request' },
  ];
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
            <h1 className="text-2xl font-bold tracking-tight">{t('rides.heading')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t('rides.intro')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`${base}/rides/mine`} className="text-sm font-medium text-primary">
              {t('rides.mine')}
            </Link>
            <Link
              href={`${base}/rides/post`}
              className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t('rides.post')}
            </Link>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-2 px-1" aria-label={t('rides.heading')}>
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
          <Link
            href={href({ women: womenOnly ? '' : '1', after: undefined })}
            aria-pressed={womenOnly}
            className={pill(womenOnly)}
          >
            {t('rides.womenOnly.filter')}
          </Link>
        </nav>

        <form method="get" className="flex flex-wrap gap-2 px-1">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {womenOnly ? <input type="hidden" name="women" value="1" /> : null}
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder={t('rides.searchPlaceholder')}
            className="ios-field flex-1"
            aria-label={t('rides.searchPlaceholder')}
          />
          <input
            type="date"
            name="day"
            defaultValue={onDate ?? ''}
            className="ios-field"
            aria-label={t('rides.filter.date')}
          />
          <button type="submit" className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold">
            {t('search.heading')}
          </button>
        </form>

        {rides.length === 0 ? (
          <EmptyState title={t('rides.empty')} />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.key} className="flex flex-col gap-2">
                <h2 className="px-1 text-sm font-semibold text-muted-foreground">{g.label}</h2>
                <ul className="flex flex-col gap-2">
                  {g.rides.map((ride) => (
                    <li key={ride.id}>
                      <RideCard
                        ride={ride}
                        base={base}
                        t={t}
                        timezone={tenant.timezone}
                        locale={tenant.locale}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {nextCursor ? (
          <div className="px-1">
            <Link href={href({ after: nextCursor })} className="text-sm font-medium text-primary">
              {t('rides.more')}
            </Link>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
