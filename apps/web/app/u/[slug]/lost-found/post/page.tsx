import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { listBuildings } from '@campusos/module-lost-found/items';
import {
  PostItemForm,
  type LostFoundFormLabels,
} from '@/app/_components/lost-found/post-item-form';
import { GetVerified } from '@/app/_components/get-verified';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { categoryLabel, lostFoundSettings, requireLostFound } from '@/lib/lost-found';
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
    title: translator(tenant.locale)('lostFound.postHeading'),
    path: `${await tenantBase(slug)}/lost-found/post`,
  });
}

export default async function LostFoundPostPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const membership = await membershipFor(actor.userId, slug);
  const verified = isVerified(membership);
  const settings = lostFoundSettings(tenant);

  const header = (
    <header className="flex flex-col gap-1 px-1">
      <h1 className="text-2xl font-bold tracking-tight">{t('lostFound.postHeading')}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{t('lostFound.postIntro')}</p>
    </header>
  );

  if (!verified) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          {header}
          <div className="ios-card flex flex-col items-start gap-3 rounded-2xl p-6">
            <p className="text-sm text-muted-foreground">{t('lostFound.postWall')}</p>
            <GetVerified />
          </div>
          <Link href={`${base}/lost-found`} className="px-1 text-sm font-medium text-primary">
            {t('lostFound.back')}
          </Link>
        </div>
      </PageShell>
    );
  }

  const buildings = await listBuildings(slug);
  const labels: LostFoundFormLabels = {
    kind: t('lostFound.form.kind'),
    lost: t('lostFound.kind.lost'),
    found: t('lostFound.kind.found'),
    title: t('lostFound.form.title'),
    titlePlaceholder: t('lostFound.form.titlePlaceholder'),
    description: t('lostFound.form.description'),
    category: t('lostFound.form.category'),
    location: t('lostFound.form.location'),
    locationPlaceholder: t('lostFound.form.locationPlaceholder'),
    building: t('lostFound.form.building'),
    buildingNone: t('lostFound.form.buildingNone'),
    date: t('lostFound.form.date'),
    optional: t('lostFound.form.optional'),
    photos: t('lostFound.form.photos'),
    photosHint: t('lostFound.form.photosHint'),
    submit: t('lostFound.form.submit'),
    submitting: t('lostFound.form.submitting'),
    failed: t('lostFound.form.failed'),
    tooLarge: t('lostFound.form.tooLarge'),
    badType: t('lostFound.form.badType'),
    categoryLabels: Object.fromEntries(settings.categories.map((c) => [c, categoryLabel(t, c)])),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        {header}
        <PostItemForm
          base={base}
          tenant={slug}
          categories={settings.categories}
          buildings={buildings}
          maxPhotos={settings.maxPhotosPerItem}
          maxUploadBytes={settings.maxUploadBytes}
          labels={labels}
        />
      </div>
    </PageShell>
  );
}
