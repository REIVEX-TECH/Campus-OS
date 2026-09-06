import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { myItems } from '@campusos/module-lost-found/write';
import { myClaims } from '@campusos/module-lost-found/claims';
import { ItemCard } from '@/app/_components/lost-found/item-card';
import { WithdrawButton } from '@/app/_components/lost-found/withdraw-button';
import { ExtendButton } from '@/app/_components/lost-found/extend-button';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
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
    title: translator(tenant.locale)('lostFound.mine'),
    path: `${await tenantBase(slug)}/lost-found/mine`,
  });
}

export default async function MyLostFoundPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireLostFound(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const [items, claims] = await Promise.all([
    myItems(actor.userId, slug),
    myClaims(actor.userId, slug),
  ]);

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('lostFound.mine')}</h1>
          <Link href={`${base}/lost-found`} className="text-sm font-medium text-primary">
            {t('lostFound.back')}
          </Link>
        </header>

        <section className="flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyState title={t('lostFound.myEmpty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1">
                  <ItemCard item={item} base={base} t={t} />
                  {item.status === 'open' ? (
                    <div className="flex flex-wrap items-center gap-2 px-1">
                      {item.expiringSoon ? (
                        <>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            {item.expiresAt
                              ? t('lostFound.expiresOn', {
                                  date: new Intl.DateTimeFormat(tenant.locale, {
                                    day: 'numeric',
                                    month: 'short',
                                  }).format(item.expiresAt),
                                })
                              : t('lostFound.expiringSoon')}
                          </span>
                          <ExtendButton
                            tenant={slug}
                            itemId={item.id}
                            label={t('lostFound.extend')}
                            busyLabel={t('lostFound.extending')}
                          />
                        </>
                      ) : null}
                      <WithdrawButton
                        tenant={slug}
                        itemId={item.id}
                        label={t('lostFound.withdraw')}
                        busyLabel={t('lostFound.withdrawing')}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-lg font-semibold">{t('lostFound.myClaims')}</h2>
          {claims.length === 0 ? (
            <EmptyState title={t('lostFound.myClaimsEmpty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {claims.map((claim) => (
                <li key={claim.id}>
                  <Link
                    href={`${base}/lost-found/${claim.itemId}?claim=${claim.id}`}
                    className="ios-card ios-pressable flex items-center justify-between gap-2 rounded-2xl p-3"
                  >
                    <span className="truncate text-sm font-medium">{claim.itemTitle}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t(`lostFound.claim.status.${claim.status}` as MessageKey)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
