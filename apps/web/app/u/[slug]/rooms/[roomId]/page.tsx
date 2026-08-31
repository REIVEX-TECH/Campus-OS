import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FreshnessLine } from '@/app/_components/freshness';
import { TimetableGrid } from '@/app/_components/timetable-grid';
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
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href={`${base}/timetable`} className="hover:underline">
              {tenant.displayName}
            </Link>{' '}
            · {t('timetable.roomTimetable')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{room.name}</h1>
          <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
        </div>
        <Link
          className={buttonVariants({ variant: 'outline' })}
          href={`${base}/rooms/${roomId}/timetable.ics`}
        >
          {t('timetable.subscribe')}
        </Link>
      </header>

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <TimetableGrid views={views} title={room.name} locale={tenant.locale} t={t} />
      )}
      <p className="mt-4 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </main>
  );
}
