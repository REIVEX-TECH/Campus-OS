import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { conversationBetween } from '@campusos/module-messages/service';
import { orderById, orderFiles, orderReview } from '@campusos/module-marketplace/orders-read';
import { MessageButton } from '@/app/_components/messages/message-button';
import { DeliveryUpload } from '@/app/_components/marketplace/delivery-upload';
import { OrderControls } from '@/app/_components/marketplace/order-controls';
import { ReviewForm } from '@/app/_components/marketplace/review-form';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { relativeTime } from '@/lib/format';
import { translator } from '@/lib/i18n';
import { requireMarketplaceServices } from '@/lib/marketplace';
import { composeLabels } from '@/lib/messages-labels';
import { messagesEnabled, messagesSettings } from '@/lib/messages';
import { formatPkr } from '@/lib/money';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; orderId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.order.heading'),
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

export default async function OrderPage({ params }: Params) {
  const { slug, orderId } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const order = await orderById(actor, slug, orderId);
  if (!order) notFound();
  const role: 'buyer' | 'seller' = order.buyerId === actor.userId ? 'buyer' : 'seller';
  const counterpartId = role === 'buyer' ? order.sellerId : order.buyerId;

  const messagesOn = messagesEnabled(tenant);
  const [existingConvo, files, myReview] = await Promise.all([
    messagesOn ? conversationBetween(actor, slug, counterpartId) : Promise.resolve(null),
    orderFiles(actor, slug, orderId),
    role === 'buyer' && order.status === 'completed'
      ? orderReview(actor, slug, orderId)
      : Promise.resolve(null),
  ]);
  const canDeliverFiles = role === 'seller' && ['in_progress', 'delivered'].includes(order.status);
  const canReview = role === 'buyer' && order.status === 'completed' && myReview === null;
  const statusText = (s: string) =>
    STATUS_KEYS[s] ? t(STATUS_KEYS[s] as Parameters<typeof t>[0]) : s;

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{order.title}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {statusText(order.status)}
            </span>
          </div>
          <span className="text-lg font-bold">{formatPkr(order.pricePaisa)}</span>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IdentityAvatar
              seed={order.counterpartAvatarSeed ?? counterpartId}
              label={order.counterpartHandle ?? ''}
              size={24}
            />
            <span>
              {role === 'buyer'
                ? t('marketplace.order.fromSeller')
                : t('marketplace.order.forBuyer')}{' '}
              {order.counterpartHandle ?? t('marketplace.gig.aSeller')}
            </span>
          </div>
        </header>

        <div className="ios-card flex flex-col gap-3 rounded-2xl p-4">
          <OrderControls
            tenant={slug}
            orderId={order.id}
            status={order.status}
            role={role}
            paymentMode={order.paymentMode}
            labels={{
              accept: t('marketplace.order.accept'),
              cancelRequest: t('marketplace.order.cancelRequest'),
              cancel: t('marketplace.order.cancel'),
              cancelConfirm: t('marketplace.order.cancelConfirm'),
              start: t('marketplace.order.start'),
              deliver: t('marketplace.order.deliver'),
              acceptDelivery: t('marketplace.order.acceptDelivery'),
              acceptConfirm: t('marketplace.order.acceptConfirm'),
              requestRevision: t('marketplace.order.requestRevision'),
              working: t('marketplace.gig.working'),
              failed: t('marketplace.form.failed'),
            }}
          />

          {order.status === 'awaiting_payment' ? (
            <div className="rounded-xl border border-dashed border-border p-3 text-sm">
              <p className="font-medium">{t('marketplace.order.paymentTitle')}</p>
              <p className="mt-1 text-muted-foreground">
                {t('marketplace.order.paymentPlaceholder')}
              </p>
            </div>
          ) : null}

          {messagesOn ? (
            <MessageButton
              tenant={slug}
              base={base}
              userId={counterpartId}
              recipientHandle={order.counterpartHandle ?? ''}
              recipientAvatarSeed={order.counterpartAvatarSeed ?? counterpartId}
              existing={existingConvo}
              maxLength={messagesSettings(tenant).maxBodyLength}
              label={t('marketplace.order.messageChat')}
              className="ios-pressable inline-flex h-9 w-fit items-center rounded-xl bg-muted px-3 text-sm font-medium text-muted-foreground hover:bg-muted/70"
              labels={composeLabels(t)}
            />
          ) : null}
        </div>

        {order.requirements ? (
          <section className="flex flex-col gap-1 px-1">
            <h2 className="text-sm font-semibold">{t('marketplace.order.requirements')}</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {order.requirements}
            </p>
          </section>
        ) : null}

        {files.length > 0 || canDeliverFiles ? (
          <section className="flex flex-col gap-2 px-1">
            <h2 className="text-sm font-semibold">{t('marketplace.order.delivery')}</h2>
            {files.length > 0 ? (
              <ul className="ios-card flex flex-col rounded-2xl p-2">
                {files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={`/api/marketplace/orders/${order.id}/files/${f.id}?tenant=${slug}`}
                      className="ios-pressable flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-sm hover:bg-muted"
                    >
                      <span className="truncate">{f.filename}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {Math.max(1, Math.round(f.byteSize / 1024))} KB
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {canDeliverFiles ? (
              <DeliveryUpload
                tenant={slug}
                orderId={order.id}
                labels={{
                  attach: t('marketplace.order.attachFile'),
                  uploading: t('marketplace.gig.working'),
                  failed: t('marketplace.form.failed'),
                  hint: t('marketplace.order.deliveryHint'),
                }}
              />
            ) : null}
          </section>
        ) : null}

        {canReview ? (
          <ReviewForm
            tenant={slug}
            orderId={order.id}
            labels={{
              heading: t('marketplace.review.heading'),
              rating: t('marketplace.review.rating'),
              comment: t('marketplace.review.comment'),
              submit: t('marketplace.review.submit'),
              submitting: t('marketplace.form.submitting'),
              failed: t('marketplace.form.failed'),
            }}
          />
        ) : null}
        {myReview ? (
          <p className="px-1 text-sm text-muted-foreground">
            {t('marketplace.review.yours', { stars: '★'.repeat(myReview.rating) })}
          </p>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">{t('marketplace.order.timeline')}</h2>
          <ol className="ios-card flex flex-col rounded-2xl p-2">
            {order.events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
              >
                <span>{e.toStatus ? statusText(e.toStatus) : e.kind}</span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(e.createdAt.toISOString(), tenant.locale)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <Link href={`${base}/orders`} className="px-1 text-sm font-medium text-primary">
          {t('marketplace.order.allOrders')}
        </Link>
      </div>
    </PageShell>
  );
}
