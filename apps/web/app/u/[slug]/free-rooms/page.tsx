import type { Metadata } from 'next';
import Link from 'next/link';
import { tenantRegistry } from '@campusos/tenants';
import { EmptyState } from '@/app/_components/empty-state';
import { FreeRoomsControl } from '@/app/_components/free-rooms-control';
import { dayName, translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { parseHHMM, tenantNow, toHHMM } from '@/lib/tenant-time';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ day?: string; from?: string; to?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('freeRooms.heading'),
    path: `${await tenantBase(slug)}/free-rooms`,
  });
}

export default async function FreeRoomsPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const now = tenantNow(tenant.timezone);
  const dayParam = Number(sp.day);
  const dayOfWeek = dayParam >= 1 && dayParam <= 7 ? dayParam : now.dayOfWeek;
  const fromMin = parseHHMM(sp.from) ?? now.minutes;
  let toMin = parseHHMM(sp.to) ?? now.minutes + 60;
  if (toMin <= fromMin) toMin = fromMin + 60;
  const from = toHHMM(fromMin);
  const to = toHHMM(toMin);

  const terms = await queries.listTermsWithSections();
  const termId = terms[0]?.id;
  const free = termId
    ? await queries.freeRooms({ termId, dayOfWeek, startsAt: from, endsAt: to })
    : [];

  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => dayName(tenant.locale, d));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 px-1">
        <p className="text-sm font-medium text-muted-foreground">{tenant.displayName}</p>
        <h1 className="text-3xl font-bold tracking-tight">{t('freeRooms.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('freeRooms.intro')}</p>
      </header>

      {!termId ? (
        <EmptyState title={t('freeRooms.noTimetable')} />
      ) : (
        <>
          <FreeRoomsControl
            day={dayOfWeek}
            from={from}
            to={to}
            labels={{
              day: t('freeRooms.day'),
              from: t('freeRooms.from'),
              to: t('freeRooms.to'),
              now: t('freeRooms.now'),
              days,
            }}
          />

          <p className="px-1 text-sm text-muted-foreground">
            {t('freeRooms.count', {
              count: free.length,
              day: dayName(tenant.locale, dayOfWeek),
              from,
              to,
            })}
          </p>

          {free.length === 0 ? (
            <EmptyState title={t('freeRooms.none')} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {free.map((room) => (
                <li key={room.id}>
                  <Link
                    href={`${base}/rooms/${room.id}`}
                    className="ios-card ios-pressable flex flex-col gap-0.5 rounded-2xl p-4 hover:shadow-[var(--shadow-card-strong)]"
                  >
                    <span className="font-semibold">{room.name}</span>
                    <span className="text-sm text-muted-foreground">{room.building}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
