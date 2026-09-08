import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { PostGigForm } from '@/app/_components/marketplace/post-gig-form';
import { GetVerified } from '@/app/_components/get-verified';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import {
  marketplaceSettings,
  requireMarketplaceServices,
  serviceCategoryLabels,
} from '@/lib/marketplace';
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
    title: translator(tenant.locale)('marketplace.services.offerHeading'),
    path: `${await tenantBase(slug)}/services/new`,
  });
}

export default async function NewGigPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const membership = await membershipFor(actor.userId, slug);
  const verified = isVerified(membership);
  const settings = marketplaceSettings(tenant);

  const header = (
    <header className="flex flex-col gap-1 px-1">
      <h1 className="text-2xl font-bold tracking-tight">
        {t('marketplace.services.offerHeading')}
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        {t('marketplace.services.offerIntro')}
      </p>
    </header>
  );

  if (!verified) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          {header}
          <div className="ios-card flex flex-col items-start gap-3 rounded-2xl p-6">
            <p className="text-sm text-muted-foreground">{t('marketplace.services.offerWall')}</p>
            <GetVerified />
          </div>
          <Link href={`${base}/services`} className="px-1 text-sm font-medium text-primary">
            {t('marketplace.back')}
          </Link>
        </div>
      </PageShell>
    );
  }

  const labels = {
    title: t('marketplace.gig.title'),
    titlePlaceholder: t('marketplace.gig.titlePlaceholder'),
    description: t('marketplace.gig.description'),
    category: t('marketplace.form.category'),
    photos: t('marketplace.gig.portfolio'),
    photosHint: t('marketplace.form.photosHint'),
    optional: t('marketplace.form.optional'),
    packages: t('marketplace.gig.packages'),
    packagesHint: t('marketplace.gig.packagesHint'),
    pkgTitle: t('marketplace.gig.pkgTitle'),
    pkgPrice: t('marketplace.gig.pkgPrice'),
    pkgDelivery: t('marketplace.gig.pkgDelivery'),
    pkgRevisions: t('marketplace.gig.pkgRevisions'),
    pkgDescription: t('marketplace.gig.pkgDescription'),
    submit: t('marketplace.gig.submit'),
    submitting: t('marketplace.form.submitting'),
    failed: t('marketplace.form.failed'),
    tooLarge: t('marketplace.form.tooLarge'),
    badType: t('marketplace.form.badType'),
    contactInfo: t('marketplace.form.contactInfo'),
    prohibitedTitle: t('marketplace.gig.prohibitedTitle'),
    prohibitedBody: t('marketplace.gig.prohibitedBody'),
    categoryLabels: serviceCategoryLabels(t, settings.serviceCategories),
    tierLabels: {
      basic: t('marketplace.gig.tier.basic'),
      standard: t('marketplace.gig.tier.standard'),
      premium: t('marketplace.gig.tier.premium'),
    },
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        {header}
        <PostGigForm
          base={base}
          tenant={slug}
          categories={settings.serviceCategories}
          maxPhotos={settings.maxPhotosPerListing}
          maxUploadBytes={settings.maxUploadBytes}
          labels={labels}
        />
      </div>
    </PageShell>
  );
}
