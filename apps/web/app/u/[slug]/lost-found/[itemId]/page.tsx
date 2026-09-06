import type { Metadata } from 'next';
import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import { itemById } from '@campusos/module-lost-found/items';
import { claimThread, listClaimsForItem } from '@campusos/module-lost-found/claims';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { ClaimArea, type ClaimLabels } from '@/app/_components/lost-found/claim-area';
import { ReportButton, type ReportLabels } from '@/app/_components/lost-found/report-button';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { categoryLabel, requireLostFound } from '@/lib/lost-found';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; itemId: string }> };
type PageProps = Params & { searchParams: Promise<{ claim?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, itemId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  const item = await itemById(slug, itemId);
  return pageMetadata({
    tenant,
    title: item ? item.title : translator(tenant.locale)('lostFound.heading'),
    path: `${await tenantBase(slug)}/lost-found/${itemId}`,
  });
}

/** One item: its photos, details, the pseudonymous reporter, and its claims. */
export default async function LostFoundItemPage({ params, searchParams }: PageProps) {
  const { slug, itemId } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const item = await itemById(slug, itemId);
  const actor = await currentActor();
  const query = await searchParams;

  const backLink = (
    <Link href={`${base}/lost-found`} className="text-sm font-medium text-primary">
      {t('lostFound.back')}
    </Link>
  );

  if (!item) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          {backLink}
          <EmptyState title={t('lostFound.notFound')} />
        </div>
      </PageShell>
    );
  }

  const kindLabel = t(item.kind === 'found' ? 'lostFound.kind.found' : 'lostFound.kind.lost');
  const reportedOn = item.createdAt.toLocaleDateString(tenant.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Claim area: what this viewer may do and see. RLS returns to the reporter
  // every claim on the item, to a claimant only their own, and to anyone else
  // nothing; the page maps that to props for the client component.
  const isReporter = actor?.userId === item.reporterId;
  const rawClaims = actor ? await listClaimsForItem(actor, slug, itemId) : [];
  const claims = rawClaims.map((c) => ({
    id: c.id,
    claimantHandle: c.claimantHandle,
    status: c.status,
    message: c.message,
    isOwn: c.claimantId === actor?.userId,
  }));
  const hasOpenOwnClaim = rawClaims.some(
    (c) => c.claimantId === actor?.userId && c.status === 'pending',
  );
  const verified = actor ? isVerified(await membershipFor(actor.userId, slug)) : false;
  const canClaim =
    Boolean(actor) && verified && !isReporter && item.status === 'open' && !hasOpenOwnClaim;
  const needsVerify =
    Boolean(actor) && !verified && !isReporter && item.status === 'open' && !hasOpenOwnClaim;
  const selectedClaimId =
    query.claim && claims.some((c) => c.id === query.claim) ? query.claim : null;
  const thread = selectedClaimId
    ? (await claimThread(actor!, slug, selectedClaimId)).map((m) => ({
        id: m.id,
        senderHandle: m.senderHandle,
        body: m.body,
        isOwn: m.senderId === actor?.userId,
      }))
    : [];
  const claimLabels: ClaimLabels = {
    button: t('lostFound.claim.button'),
    intro: t('lostFound.claim.intro'),
    messagePlaceholder: t('lostFound.claim.messagePlaceholder'),
    open: t('lostFound.claim.open'),
    opening: t('lostFound.claim.opening'),
    claimsHeading: t('lostFound.claim.claimsHeading'),
    noClaims: t('lostFound.claim.noClaims'),
    yourClaim: t('lostFound.claim.yourClaim'),
    confirm: t('lostFound.claim.confirm'),
    reject: t('lostFound.claim.reject'),
    withdraw: t('lostFound.claim.withdraw'),
    working: t('lostFound.claim.working'),
    thread: t('lostFound.claim.thread'),
    send: t('lostFound.claim.send'),
    sending: t('lostFound.claim.sending'),
    resolvedNote: t('lostFound.claim.resolvedNote'),
    notVerified: t('lostFound.claim.notVerified'),
    failed: t('lostFound.claim.failed'),
    status: {
      pending: t('lostFound.claim.status.pending'),
      approved: t('lostFound.claim.status.approved'),
      denied: t('lostFound.claim.status.denied'),
      withdrawn: t('lostFound.claim.status.withdrawn'),
    },
  };
  const reportLabels: ReportLabels = {
    button: t('lostFound.report.button'),
    intro: t('lostFound.report.intro'),
    reasons: [
      { value: 'spam', label: t('lostFound.report.reason.spam') },
      { value: 'inappropriate', label: t('lostFound.report.reason.inappropriate') },
      { value: 'scam', label: t('lostFound.report.reason.scam') },
      { value: 'other', label: t('lostFound.report.reason.other') },
    ],
    notePlaceholder: t('lostFound.report.notePlaceholder'),
    send: t('lostFound.report.send'),
    sending: t('lostFound.report.sending'),
    done: t('lostFound.report.done'),
    failed: t('lostFound.report.failed'),
  };

  return (
    <PageShell>
      <article className="flex flex-col gap-4">
        {backLink}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              item.kind === 'found'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {kindLabel}
          </span>
          {item.status !== 'open' ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t(`lostFound.status.${item.status}` as MessageKey)}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {categoryLabel(t, item.category)}
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">{item.title}</h1>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IdentityAvatar seed={item.reporterAvatarSeed ?? item.reporterId} label="" size={28} />
          {item.reporterHandle ? (
            <Link
              href={`${base}/people/${item.reporterHandle}`}
              className="font-medium text-foreground"
            >
              {item.reporterHandle}
            </Link>
          ) : (
            <span>{t('lostFound.reportedBy', { handle: '?' })}</span>
          )}
          <span>· {reportedOn}</span>
        </div>

        {item.photos.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {item.photos.map((photo) => (
              <img
                key={photo.storageKey}
                src={mediaUrl(photo.storageKey)}
                alt=""
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
                loading="lazy"
                className="w-full rounded-2xl object-cover"
              />
            ))}
          </div>
        ) : null}

        {item.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.description}</p>
        ) : null}

        <dl className="ios-card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl p-4 text-sm">
          {item.locationText ? (
            <>
              <dt className="text-muted-foreground">{t('lostFound.location')}</dt>
              <dd>{item.locationText}</dd>
            </>
          ) : null}
          {item.buildingName ? (
            <>
              <dt className="text-muted-foreground">{t('lostFound.building')}</dt>
              <dd>{item.buildingName}</dd>
            </>
          ) : null}
          {item.happenedOn ? (
            <>
              <dt className="text-muted-foreground">{t('lostFound.happenedOn')}</dt>
              <dd>{item.happenedOn}</dd>
            </>
          ) : null}
        </dl>

        {actor ? (
          <ClaimArea
            base={base}
            tenant={slug}
            itemId={item.id}
            itemStatus={item.status}
            isReporter={isReporter}
            canClaim={canClaim}
            needsVerify={needsVerify}
            claims={claims}
            selectedClaimId={selectedClaimId}
            thread={thread}
            labels={claimLabels}
            reportLabels={reportLabels}
          />
        ) : null}

        {actor && !isReporter ? (
          <div className="px-1">
            <ReportButton
              tenant={slug}
              targetType="lf_item"
              targetId={item.id}
              labels={reportLabels}
            />
          </div>
        ) : null}
      </article>
    </PageShell>
  );
}
