import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { moderationQueue } from '@campusos/module-marketplace/moderation';
import { ModQueue } from '@/app/_components/marketplace/mod-queue';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { requireMarketplace } from '@/lib/marketplace';
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
    title: translator(tenant.locale)('marketplace.mod.heading'),
    path: `${await tenantBase(slug)}/marketplace/mod`,
  });
}

export default async function MarketplaceModPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  // The queue definer returns nothing to a non-moderator, so the page is safe to
  // render for anyone signed in (a non-moderator simply sees an empty queue).
  const entries = await moderationQueue(actor, slug);

  const labels = {
    reportedBy: t('marketplace.mod.reportedBy'),
    view: t('marketplace.mod.view'),
    remove: t('marketplace.mod.remove'),
    dismiss: t('marketplace.mod.dismiss'),
    removeReason: t('marketplace.mod.removeReason'),
    confirm: t('marketplace.mod.confirm'),
    cancel: t('marketplace.mod.cancel'),
    working: t('marketplace.mod.working'),
    failed: t('marketplace.mod.failed'),
    unknownMember: t('marketplace.mod.unknownMember'),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.mod.heading')}</h1>
          <p className="text-sm text-muted-foreground">{t('marketplace.mod.intro')}</p>
        </header>
        {entries.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.mod.empty')}
          </p>
        ) : (
          <ModQueue
            tenant={slug}
            base={base}
            entries={entries.map((e) => ({
              reportId: e.reportId,
              targetId: e.targetId,
              reason: e.reason,
              note: e.note,
              reporterHandle: e.reporterHandle,
              listingId: e.listingId,
              listingTitle: e.listingTitle,
            }))}
            labels={labels}
          />
        )}
      </div>
    </PageShell>
  );
}
