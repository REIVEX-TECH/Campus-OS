import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { myRides } from '@campusos/module-rides/posts';
import { mySeatRequests, type MySeatRequest } from '@campusos/module-rides/seats';
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

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.mine'),
    path: `${await tenantBase(slug)}/rides/mine`,
  });
}

export default async function MyRidesPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const [driving, seatRequests] = await Promise.all([
    myRides(actor.userId, slug),
    mySeatRequests(actor, slug),
  ]);
  const riding = seatRequests.filter((r) => r.status === 'accepted');
  const pending = seatRequests.filter((r) => r.status === 'pending');

  const requestRow = (r: MySeatRequest) => (
    <li key={r.id}>
      <Link
        href={`${base}/rides/${r.rideId}`}
        className="ios-card ios-pressable flex items-center justify-between gap-3 rounded-xl p-3"
      >
        <span className="truncate text-sm font-medium">
          {r.originText} <span aria-hidden>&rarr;</span> {r.destText}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {new Intl.DateTimeFormat(tenant.locale, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: tenant.timezone,
          }).format(r.departAt)}
        </span>
      </Link>
    </li>
  );

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-3 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('rides.mine')}</h1>
          <Link href={`${base}/rides`} className="text-sm font-medium text-primary">
            {t('rides.browseLink')}
          </Link>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">
            {t('rides.mineDriving')}
          </h2>
          {driving.length === 0 ? (
            <EmptyState title={t('rides.mineNoDriving')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {driving.map((ride) => (
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
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">
            {t('rides.mineRiding')}
          </h2>
          {riding.length === 0 ? (
            <EmptyState title={t('rides.mineNoRiding')} />
          ) : (
            <ul className="flex flex-col gap-2">{riding.map(requestRow)}</ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">
            {t('rides.mineRequests')}
          </h2>
          {pending.length === 0 ? (
            <EmptyState title={t('rides.mineNoRequests')} />
          ) : (
            <ul className="flex flex-col gap-2">{pending.map(requestRow)}</ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
