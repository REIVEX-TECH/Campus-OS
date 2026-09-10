import type { Metadata } from 'next';
import Link from 'next/link';
import { moderationQueue } from '@campusos/module-rides/safety';
import { RidesModQueue } from '@/app/_components/rides/mod-queue';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
import { translator } from '@/lib/i18n';
import { requireRides } from '@/lib/rides';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('rides.mod.heading'),
    path: `${await tenantBase(slug)}/rides/mod`,
  });
}

/** The rides moderation queue. Gated on rides.moderate. */
export default async function RidesModPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireRides(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor } = await accessForPage(slug, 'rides.moderate');

  const entries = (await moderationQueue(actor, slug)).map((e) => ({
    reportId: e.reportId,
    targetType: e.targetType,
    targetId: e.targetId,
    reason: e.reason,
    note: e.note,
    reporterHandle: e.reporterHandle,
    rideOrigin: e.rideOrigin,
    rideDest: e.rideDest,
    reportedHandle: e.reportedHandle,
  }));

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t('rides.mod.heading')}</h1>
            <p className="text-sm text-muted-foreground">{t('rides.mod.intro')}</p>
          </div>
          <Link href={`${base}/rides`} className="text-sm font-medium text-primary">
            {t('rides.browseLink')}
          </Link>
        </header>
        <RidesModQueue
          base={base}
          tenant={slug}
          entries={entries}
          labels={{
            empty: t('rides.mod.empty'),
            targetRide: t('rides.mod.targetRide'),
            targetUser: t('rides.mod.targetUser'),
            reportedBy: t('rides.mod.reportedBy'),
            view: t('rides.mod.view'),
            remove: t('rides.mod.remove'),
            removeReason: t('rides.mod.removeReason'),
            cancel: t('rides.mod.cancel'),
            dismiss: t('rides.mod.dismiss'),
            working: t('rides.mod.working'),
          }}
        />
      </div>
    </PageShell>
  );
}
