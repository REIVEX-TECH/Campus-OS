import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FilterableTimetable } from '@/app/_components/filterable-timetable';
import { FreshnessLine } from '@/app/_components/freshness';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getQueries, requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; roomId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, roomId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return {};
  const room = await getQueries(slug).getRoom(roomId);
  const title = room?.name ?? translator(tenant.locale)('timetable.roomTimetable');
  return pageMetadata({ tenant, title, path: `${await tenantBase(slug)}/rooms/${roomId}` });
}

export default async function RoomTimetable({ params }: Params) {
  const { slug, roomId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const room = await queries.getRoom(roomId);
  if (!room) notFound();

  const [views, freshness] = await Promise.all([
    queries.roomTimetable(roomId),
    queries.freshness(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`${base}/timetable`} className="text-primary hover:underline">
              {tenant.displayName}
            </Link>{' '}
            · {t('timetable.roomTimetable')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{room.name}</h1>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </div>
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={`${base}/rooms/${roomId}/timetable.ics`}
        >
          {t('timetable.subscribe')}
        </Link>
      </header>

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <FilterableTimetable views={views} title={room.name} locale={tenant.locale} base={base} />
      )}
      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
