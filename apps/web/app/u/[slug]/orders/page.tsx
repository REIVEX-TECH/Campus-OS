import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyOrders } from '@campusos/module-marketplace/orders-read';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { requireMarketplaceServices } from '@/lib/marketplace';
import { formatPkr } from '@/lib/money';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Search = { searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.order.allOrders'),
    path: `${await tenantBase(slug)}/orders`,
    noIndex: true,
  });
}

const STATUS_KEYS: Record<string, string> = {
  requested: 'marketplace.order.status.requested',
  awaiting_payment: 'marketplace.order.status.awaiting_payment',
  paid: 'marketplace.order.status.paid',
  in_progress: 'marketplace.order.status.in_progress',
  delivered: 'marketplace.order.status.delivered',
  completed: 'marketplace.order.status.completed',
  cancelled: 'marketplace.order.status.cancelled',
  disputed: 'marketplace.order.status.disputed',
};

export default async function OrdersPage({ params, searchParams }: Params & Search) {
  const { slug } = await params;
  const { tab: tabParam } = await searchParams;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const role: 'buyer' | 'seller' = tabParam === 'selling' ? 'seller' : 'buyer';
  const orders = await listMyOrders(actor, slug, role);
  const statusText = (s: string) =>
    STATUS_KEYS[s] ? t(STATUS_KEYS[s] as Parameters<typeof t>[0]) : s;

  const tab = (key: 'buying' | 'selling', current: boolean) => (
    <Link
      href={key === 'buying' ? `${base}/orders` : `${base}/orders?tab=selling`}
      aria-current={current ? 'page' : undefined}
      className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
        current ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {key === 'buying' ? t('marketplace.order.buying') : t('marketplace.order.selling')}
    </Link>
  );

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <h1 className="px-1 text-2xl font-bold tracking-tight">
          {t('marketplace.order.allOrders')}
        </h1>
        <nav className="flex gap-1 px-1">
          {tab('buying', role === 'buyer')}
          {tab('selling', role === 'seller')}
        </nav>

        {orders.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.order.none')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`${base}/orders/${o.id}`}
                  className="ios-card ios-pressable flex items-center gap-3 rounded-2xl p-3 hover:bg-muted"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{o.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {o.counterpartHandle ?? t('marketplace.gig.aSeller')} ·{' '}
                      {formatPkr(o.pricePaisa)} ·{' '}
                      {relativeTime(o.createdAt.toISOString(), tenant.locale)}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {statusText(o.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
