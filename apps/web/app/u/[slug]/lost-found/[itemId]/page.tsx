import type { Metadata } from 'next';
import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import { itemById } from '@campusos/module-lost-found/items';
import { EmptyState } from '@/app/_components/empty-state';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { translator, type MessageKey } from '@/lib/i18n';
import { categoryLabel, requireLostFound } from '@/lib/lost-found';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; itemId: string }> };

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

/** One item: its photos, details and the pseudonymous reporter. */
export default async function LostFoundItemPage({ params }: Params) {
  const { slug, itemId } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const item = await itemById(slug, itemId);

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
      </article>
    </PageShell>
  );
}
