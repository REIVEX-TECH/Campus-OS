import type { Metadata } from 'next';
import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import { isListingSaved, listingById } from '@campusos/module-marketplace/listings';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { MessageSellerButton } from '@/app/_components/marketplace/message-seller-button';
import { SaveButton } from '@/app/_components/marketplace/save-button';
import { SellerControls } from '@/app/_components/marketplace/seller-controls';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import {
  categoryLabel,
  conditionLabel,
  marketplaceSettings,
  requireMarketplace,
} from '@/lib/marketplace';
import { messagesEnabled, messagesSettings } from '@/lib/messages';
import { composeLabels } from '@/lib/messages-labels';
import { formatPkr } from '@/lib/money';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; listingId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, listingId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const listing = await listingById(slug, listingId);
  return pageMetadata({
    tenant,
    title: listing?.title ?? translator(tenant.locale)('marketplace.heading'),
    path: `${await tenantBase(slug)}/marketplace/${listingId}`,
  });
}

export default async function MarketplaceListingPage({ params }: Params) {
  const { slug, listingId } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const listing = await listingById(slug, listingId);
  const actor = await currentActor();
  const isOwn = Boolean(listing) && actor?.userId === listing?.sellerId;
  const settings = marketplaceSettings(tenant);
  // A sold listing stays viewable for a window, then hides from everyone but its
  // seller (who keeps seeing it in their own listings).
  const soldHidden =
    listing?.status === 'sold' && listing.soldAt
      ? Date.now() - listing.soldAt.getTime() > settings.soldVisibleDays * 86_400_000
      : false;
  if (!listing || listing.status === 'removed' || (soldHidden && !isOwn)) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          <p className="px-1 text-sm text-muted-foreground">
            {listing?.status === 'removed'
              ? t('marketplace.detail.removed')
              : t('marketplace.detail.notFound')}
          </p>
          <Link href={`${base}/marketplace`} className="px-1 text-sm font-medium text-primary">
            {t('marketplace.back')}
          </Link>
        </div>
      </PageShell>
    );
  }

  const canMessage =
    Boolean(actor) &&
    !isOwn &&
    messagesEnabled(tenant) &&
    (listing.status === 'active' || listing.status === 'reserved') &&
    listing.sellerHandle !== null;
  const canSave = Boolean(actor) && !isOwn;
  const saved = canSave ? await isListingSaved(actor!.userId, slug, listing.id) : false;
  const price =
    listing.pricePaisa === 0 ? t('marketplace.price.free') : formatPkr(listing.pricePaisa);
  const statusBadge =
    listing.status === 'sold'
      ? t('marketplace.detail.sold')
      : listing.status === 'reserved'
        ? t('marketplace.detail.reserved')
        : null;

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <Link href={`${base}/marketplace`} className="px-1 text-sm font-medium text-primary">
          &#8592; {t('marketplace.back')}
        </Link>

        {listing.photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {listing.photos.map((photo) => (
              <li key={photo.storageKey} className="ios-card overflow-hidden rounded-2xl">
                <img
                  src={mediaUrl(photo.storageKey)}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{listing.title}</h1>
            {statusBadge ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {statusBadge}
              </span>
            ) : null}
          </div>
          <p className="text-xl font-semibold">
            {price}
            {listing.priceKind === 'negotiable' && listing.pricePaisa > 0 ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t('marketplace.card.negotiable')}
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {categoryLabel(t, listing.category)} &middot; {t('marketplace.detail.conditionLabel')}:{' '}
            {conditionLabel(t, listing.condition)}
          </p>
        </div>

        {listing.description ? (
          <p className="whitespace-pre-wrap px-1 text-[15px] leading-relaxed">
            {listing.description}
          </p>
        ) : null}

        {listing.meetupPref ? (
          <p className="px-1 text-sm text-muted-foreground">
            {t('marketplace.detail.meetupLabel')}: {listing.meetupPref}
          </p>
        ) : null}

        <div className="flex items-center gap-2 px-1">
          <IdentityAvatar
            seed={listing.sellerAvatarSeed ?? listing.sellerId}
            label={listing.sellerHandle ?? ''}
            size={28}
          />
          {listing.sellerHandle ? (
            <Link
              href={`${base}/people/${listing.sellerHandle}`}
              className="text-sm font-medium hover:underline"
            >
              {t('marketplace.detail.postedBy', { handle: listing.sellerHandle })}
            </Link>
          ) : null}
        </div>

        {isOwn ? (
          <div className="px-1">
            <SellerControls
              tenant={slug}
              base={base}
              listingId={listing.id}
              status={listing.status}
              labels={{
                markReserved: t('marketplace.seller.markReserved'),
                markSold: t('marketplace.seller.markSold'),
                relist: t('marketplace.seller.relist'),
                backToActive: t('marketplace.seller.backToActive'),
                extend: t('marketplace.seller.extend'),
                del: t('marketplace.seller.delete'),
                delConfirm: t('marketplace.seller.deleteConfirm'),
                working: t('marketplace.seller.working'),
                failed: t('marketplace.seller.failed'),
              }}
            />
          </div>
        ) : null}

        <p className="px-1 text-xs text-muted-foreground">{t('marketplace.detail.cashOnMeetup')}</p>

        {canMessage || canSave ? (
          <div className="flex flex-wrap items-center gap-2 px-1">
            {canMessage && listing.sellerHandle ? (
              <MessageSellerButton
                tenant={slug}
                base={base}
                sellerId={listing.sellerId}
                sellerHandle={listing.sellerHandle}
                sellerAvatarSeed={listing.sellerAvatarSeed ?? listing.sellerId}
                listingTitle={listing.title}
                listingPath={`/marketplace/${listing.id}`}
                maxLength={messagesSettings(tenant).maxBodyLength}
                label={t('marketplace.detail.messageSeller')}
                labels={composeLabels(t)}
              />
            ) : null}
            {canSave ? (
              <SaveButton
                tenant={slug}
                listingId={listing.id}
                initialSaved={saved}
                labels={{
                  save: t('marketplace.action.save'),
                  saved: t('marketplace.action.saved'),
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
