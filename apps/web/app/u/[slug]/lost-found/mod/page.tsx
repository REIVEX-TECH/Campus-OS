import type { Metadata } from 'next';
import Link from 'next/link';
import { moderationQueue } from '@campusos/module-lost-found/moderation';
import { LostFoundModQueue } from '@/app/_components/lost-found/mod-queue';
import { PageShell } from '@/app/_components/page-shell';
import { accessForPage } from '@/lib/tenant-access';
import { translator } from '@/lib/i18n';
import { requireLostFound } from '@/lib/lost-found';
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
    title: translator(tenant.locale)('lostFound.mod.heading'),
    path: `${await tenantBase(slug)}/lost-found/mod`,
  });
}

/** The Lost & Found moderation queue. Gated on lostfound.moderate. */
export default async function LostFoundModPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const { actor } = await accessForPage(slug, 'lostfound.moderate');

  const entries = (await moderationQueue(actor, slug)).map((e) => ({
    reportId: e.reportId,
    targetType: e.targetType,
    targetId: e.targetId,
    reason: e.reason,
    note: e.note,
    reporterHandle: e.reporterHandle,
    itemId: e.itemId,
    itemTitle: e.itemTitle,
    claimMessage: e.claimMessage,
  }));

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t('lostFound.mod.heading')}</h1>
            <p className="text-sm text-muted-foreground">{t('lostFound.mod.intro')}</p>
          </div>
          <Link href={`${base}/lost-found`} className="text-sm font-medium text-primary">
            {t('lostFound.back')}
          </Link>
        </header>
        <LostFoundModQueue
          base={base}
          tenant={slug}
          entries={entries}
          labels={{
            empty: t('lostFound.mod.empty'),
            reportedItem: t('lostFound.mod.reportedItem'),
            reportedClaim: t('lostFound.mod.reportedClaim'),
            by: t('lostFound.mod.by'),
            viewItem: t('lostFound.mod.viewItem'),
            remove: t('lostFound.mod.remove'),
            removePrompt: t('lostFound.mod.removePrompt'),
            dismiss: t('lostFound.mod.dismiss'),
            working: t('lostFound.mod.working'),
          }}
        />
      </div>
    </PageShell>
  );
}
