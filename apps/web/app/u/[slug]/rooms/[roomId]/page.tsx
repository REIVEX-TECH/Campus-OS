import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { buttonVariants } from '@campusos/ui';
import { EmptyState } from '@/app/_components/empty-state';
import { FilterableTimetable } from '@/app/_components/filterable-timetable';
import { FreshnessLine } from '@/app/_components/freshness';
import { FreeSlotsCard } from '@/app/_components/profile/free-slots-card';
import { ProfileHeader } from '@/app/_components/profile/profile-header';
import { StatGrid } from '@/app/_components/profile/stat-grid';
import { countText, dayName, translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { roomInitials } from '@/lib/room-label';
import { formatDuration, timetableStats } from '@/lib/timetable-stats';
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

/**
 * A room profile: how heavily it is used, which courses sit in it, when it is
 * free, and its week. Every figure comes from the class list already fetched for
 * the timetable, so the page makes no extra reads and the numbers always agree
 * with the grid. Utilisation is measured against the tenant's teaching window,
 * so two rooms are compared on the same denominator.
 */
export default async function RoomProfile({ params }: Params) {
  const { slug, roomId } = await params;
  const tenant = requireTenant(slug);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const queries = getQueries(slug);

  const room = await queries.getRoom(roomId);
  if (!room) notFound();

  const [views, freshness, window] = await Promise.all([
    queries.roomTimetable(roomId),
    queries.freshness(),
    queries.teachingWindow(),
  ]);

  const stats = timetableStats(views, window);
  const figures = [
    { label: t('profile.classes'), value: String(stats.classes) },
    { label: t('profile.hours'), value: formatDuration(stats.busyMinutes) },
    {
      label: t('profile.utilisation'),
      value: stats.utilisationPct === null ? t('timetable.tba') : `${stats.utilisationPct}%`,
    },
    { label: t('profile.courses'), value: String(stats.courses.length) },
    {
      label: t('profile.busiest'),
      value: stats.busiestDay ? dayName(tenant.locale, stats.busiestDay) : t('timetable.tba'),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ProfileHeader
        seed={room.id}
        title={room.name}
        initials={roomInitials(room.name)}
        context={
          <>
            <Link href={`${base}/rooms`} className="text-primary hover:underline">
              {t('rooms.heading')}
            </Link>{' '}
            <span aria-hidden="true">·</span>{' '}
            <FreshnessLine freshness={freshness} locale={tenant.locale} t={t} />
          </>
        }
        actions={
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={`${base}/rooms/${roomId}/timetable.ics`}
          >
            {t('timetable.subscribe')}
          </Link>
        }
      />

      {views.length === 0 ? (
        <EmptyState title={t('timetable.empty.noEntries')} />
      ) : (
        <>
          <StatGrid stats={figures} />

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section className="ios-card flex flex-col gap-3 rounded-2xl p-4">
              <h2 className="text-base font-semibold">{t('profile.coursesTaught')}</h2>
              <ul className="flex flex-col gap-2">
                {stats.courses.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`${base}/courses/${c.id}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {countText(tenant.locale, 'classes', c.classes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <FreeSlotsCard
              freeByDay={stats.freeByDay}
              window={window}
              locale={tenant.locale}
              t={t}
            />
          </div>

          <FilterableTimetable views={views} title={room.name} locale={tenant.locale} base={base} />
        </>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t('timetable.provenance')}</p>
    </div>
  );
}
