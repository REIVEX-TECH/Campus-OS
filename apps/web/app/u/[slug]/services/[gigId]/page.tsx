import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { mediaUrl } from '@campusos/media';
import { gigById } from '@campusos/module-marketplace/services-read';
import { GigSellerControls } from '@/app/_components/marketplace/gig-seller-controls';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { countText, translator } from '@/lib/i18n';
import { requireMarketplaceServices, serviceCategoryLabel } from '@/lib/marketplace';
import { formatPkr } from '@/lib/money';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; gigId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, gigId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const gig = await gigById(slug, gigId);
  if (!gig) return {};
  return pageMetadata({
    tenant,
    title: gig.title,
    path: `${await tenantBase(slug)}/services/${gigId}`,
  });
}

export default async function GigDetailPage({ params }: Params) {
  const { slug, gigId } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const gig = await gigById(slug, gigId);
  if (!gig) notFound();
  const actor = await currentActor();
  const isSeller = actor?.userId === gig.sellerId;

  const tierLabel: Record<string, string> = {
    basic: t('marketplace.gig.tier.basic'),
    standard: t('marketplace.gig.tier.standard'),
    premium: t('marketplace.gig.tier.premium'),
  };

  return (
    <PageShell>
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-2 px-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {serviceCategoryLabel(t, gig.category)}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{gig.title}</h1>
          <div className="flex items-center gap-2">
            <IdentityAvatar
              seed={gig.sellerAvatarSeed ?? gig.sellerId}
              label={gig.sellerHandle ?? ''}
              size={28}
            />
            <span className="text-sm text-muted-foreground">
              {gig.sellerHandle ?? t('marketplace.gig.aSeller')}
            </span>
            {gig.ratingCount > 0 && gig.ratingAvg !== null ? (
              <span className="text-sm text-muted-foreground">
                · {gig.ratingAvg.toFixed(1)} ({gig.ratingCount})
              </span>
            ) : null}
          </div>
        </header>

        {gig.photos.length > 0 ? (
          <ul className="flex gap-3 overflow-x-auto px-1">
            {gig.photos.map((p) => (
              <li key={p.storageKey} className="shrink-0">
                <img
                  src={mediaUrl(p.storageKey)}
                  alt=""
                  className="h-56 w-auto rounded-2xl object-cover"
                  loading="lazy"
                />
              </li>
            ))}
          </ul>
        ) : null}

        {gig.description ? (
          <p className="max-w-prose whitespace-pre-wrap px-1 text-sm leading-relaxed text-muted-foreground">
            {gig.description}
          </p>
        ) : null}

        {isSeller ? (
          <div className="ios-card flex flex-col gap-2 rounded-2xl p-3">
            <span className="text-sm font-medium">{t('marketplace.gig.yourGig')}</span>
            <GigSellerControls
              tenant={slug}
              base={base}
              gigId={gig.id}
              status={gig.status}
              labels={{
                pause: t('marketplace.gig.pause'),
                activate: t('marketplace.gig.activate'),
                del: t('marketplace.gig.delete'),
                delConfirm: t('marketplace.gig.deleteConfirm'),
                working: t('marketplace.gig.working'),
                failed: t('marketplace.form.failed'),
              }}
            />
          </div>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-lg font-semibold tracking-tight">
            {t('marketplace.gig.packages')}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {gig.packages.map((pkg) => (
              <li key={pkg.id} className="ios-card flex flex-col gap-2 rounded-2xl p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {tierLabel[pkg.tier] ?? pkg.tier}
                </span>
                <span className="text-sm font-semibold">{pkg.title}</span>
                <span className="text-lg font-bold">{formatPkr(pkg.pricePaisa)}</span>
                <span className="text-xs text-muted-foreground">
                  {countText(tenant.locale, 'days', pkg.deliveryDays)} ·{' '}
                  {countText(tenant.locale, 'revisions', pkg.revisions)}
                </span>
                {pkg.description ? (
                  <p className="text-xs text-muted-foreground">{pkg.description}</p>
                ) : null}
                {!isSeller && actor ? (
                  <Link
                    href={`${base}/services/${gig.id}/order?package=${pkg.id}`}
                    className="ios-pressable mt-1 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    {t('marketplace.gig.continue')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <Link href={`${base}/services`} className="px-1 text-sm font-medium text-primary">
          {t('marketplace.back')}
        </Link>
      </article>
    </PageShell>
  );
}
