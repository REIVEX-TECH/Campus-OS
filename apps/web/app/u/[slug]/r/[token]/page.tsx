import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveSharedRide } from '@campusos/module-rides/share';
import { PageShell } from '@/app/_components/page-shell';
import { EmptyState } from '@/app/_components/empty-state';
import { translator, type MessageKey } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';
import { requireRides } from '@/lib/rides';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  // A private capability link: never indexed.
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.share.pageTitle'),
    path: `${await tenantBase(slug)}/rides`,
    noIndex: true,
  });
}

/** The public bearer-token trip page. No auth: the token is the capability. */
export default async function SharedRidePage({ params }: Params) {
  const { slug, token } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const ride = await resolveSharedRide(slug, token);

  if (!ride) {
    // One generic message for unknown / revoked / expired, so the page is not an
    // oracle for whether a token ever existed.
    return (
      <PageShell>
        <EmptyState title={t('rides.share.gone')}>
          <Link href={`${base}/rides`} className="font-medium text-primary hover:underline">
            {t('rides.browseLink')}
          </Link>
        </EmptyState>
      </PageShell>
    );
  }

  const when = new Intl.DateTimeFormat(tenant.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tenant.timezone,
  }).format(ride.departAt);

  const statusLabelKey: MessageKey = 'rides.share.badge';

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t(statusLabelKey)}
            </span>
            {ride.womenOnly ? (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {t('rides.womenOnly.badge')}
              </span>
            ) : null}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {ride.originText} <span aria-hidden>&rarr;</span> {ride.destText}
          </h1>
          <p className="text-sm text-muted-foreground">{when}</p>
          {ride.seatsAvailable !== null ? (
            <p className="text-sm text-muted-foreground">
              {ride.seatsAvailable > 0
                ? t('rides.seatsLeft').replace('{n}', String(ride.seatsAvailable))
                : t('rides.full')}
            </p>
          ) : null}
          {ride.driverHandle ? (
            <p className="text-sm text-muted-foreground">@{ride.driverHandle}</p>
          ) : null}
        </div>

        {ride.notes ? <p className="whitespace-pre-wrap text-[15px]">{ride.notes}</p> : null}

        <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          {t('rides.share.note')}
        </p>

        <Link href={`${base}/rides`} className="text-sm font-medium text-primary hover:underline">
          {t('rides.share.openApp')}
        </Link>
      </div>
    </PageShell>
  );
}
