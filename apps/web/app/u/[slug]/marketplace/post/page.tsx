import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { PostListingForm } from '@/app/_components/marketplace/post-listing-form';
import { GetVerified } from '@/app/_components/get-verified';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import {
  categoryLabels,
  conditionLabels,
  marketplaceSettings,
  requireMarketplace,
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
    title: translator(tenant.locale)('marketplace.postHeading'),
    path: `${await tenantBase(slug)}/marketplace/post`,
  });
}

export default async function MarketplacePostPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const membership = await membershipFor(actor.userId, slug);
  const verified = isVerified(membership);
  const settings = marketplaceSettings(tenant);

  const header = (
    <header className="flex flex-col gap-1 px-1">
      <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.postHeading')}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{t('marketplace.postIntro')}</p>
    </header>
  );

  if (!verified) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          {header}
          <div className="ios-card flex flex-col items-start gap-3 rounded-2xl p-6">
            <p className="text-sm text-muted-foreground">{t('marketplace.postWall')}</p>
            <GetVerified />
          </div>
          <Link href={`${base}/marketplace`} className="px-1 text-sm font-medium text-primary">
            {t('marketplace.back')}
          </Link>
        </div>
      </PageShell>
    );
  }

  const labels = {
    title: t('marketplace.form.title'),
    titlePlaceholder: t('marketplace.form.titlePlaceholder'),
    description: t('marketplace.form.description'),
    price: t('marketplace.form.price'),
    pricePlaceholder: t('marketplace.form.pricePlaceholder'),
    priceKind: t('marketplace.form.priceKind'),
    fixed: t('marketplace.form.fixed'),
    negotiable: t('marketplace.form.negotiable'),
    category: t('marketplace.form.category'),
    condition: t('marketplace.form.condition'),
    meetup: t('marketplace.form.meetup'),
    meetupPlaceholder: t('marketplace.form.meetupPlaceholder'),
    photos: t('marketplace.form.photos'),
    photosHint: t('marketplace.form.photosHint'),
    optional: t('marketplace.form.optional'),
    submit: t('marketplace.form.submit'),
    submitting: t('marketplace.form.submitting'),
    failed: t('marketplace.form.failed'),
    tooLarge: t('marketplace.form.tooLarge'),
    badType: t('marketplace.form.badType'),
    contactInfo: t('marketplace.form.contactInfo'),
    prohibitedTitle: t('marketplace.form.prohibitedTitle'),
    prohibitedBody: t('marketplace.form.prohibitedBody'),
    categoryLabels: categoryLabels(t, settings.categories),
    conditionLabels: conditionLabels(t),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        {header}
        <PostListingForm
          base={base}
          tenant={slug}
          categories={settings.categories}
          maxPhotos={settings.maxPhotosPerListing}
          maxUploadBytes={settings.maxUploadBytes}
          labels={labels}
        />
        <Link href={`${base}/marketplace/policy`} className="px-1 text-xs font-medium text-primary">
          {t('marketplace.policy.link')}
        </Link>
      </div>
    </PageShell>
  );
}
