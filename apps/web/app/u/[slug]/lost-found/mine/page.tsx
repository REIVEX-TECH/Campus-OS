import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { myItems } from '@campusos/module-lost-found/write';
import { ItemCard } from '@/app/_components/lost-found/item-card';
import { WithdrawButton } from '@/app/_components/lost-found/withdraw-button';
import { EmptyState } from '@/app/_components/empty-state';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
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

  const items = await myItems(actor.userId, slug);

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('lostFound.mine')}</h1>
          <Link href={`${base}/lost-found`} className="text-sm font-medium text-primary">
            {t('lostFound.back')}
          </Link>
        </header>
        {items.length === 0 ? (
          <EmptyState title={t('lostFound.myEmpty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1">
                <ItemCard item={item} base={base} t={t} />
                {item.status === 'open' ? (
                  <div className="px-1">
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
      </div>
    </PageShell>
  );
}
