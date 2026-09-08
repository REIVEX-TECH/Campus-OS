import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isVerified, membershipFor } from '@campusos/module-identity/membership';
import { gigById } from '@campusos/module-marketplace/services-read';
import { OrderRequestForm } from '@/app/_components/marketplace/order-request-form';
import { GetVerified } from '@/app/_components/get-verified';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { countText, translator } from '@/lib/i18n';
import { requireMarketplaceServices } from '@/lib/marketplace';
import { formatPkr } from '@/lib/money';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; gigId: string }> };
type Search = { searchParams: Promise<{ package?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, gigId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.order.requestHeading'),
    path: `${await tenantBase(slug)}/services/${gigId}/order`,
    noIndex: true,
  });
}

export default async function OrderRequestPage({ params, searchParams }: Params & Search) {
  const { slug, gigId } = await params;
  const { package: packageId } = await searchParams;
  const tenant = await requireTenant(slug);
  requireMarketplaceServices(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const gig = await gigById(slug, gigId);
  if (!gig) notFound();
  const pkg = gig.packages.find((p) => p.id === packageId);
  if (!pkg) notFound();
  // A seller cannot order their own gig; send them back to the gig.
  if (gig.sellerId === actor.userId) redirect(`${base}/services/${gigId}`);

  const membership = await membershipFor(actor.userId, slug);
  const verified = isVerified(membership);

  const header = (
    <header className="flex flex-col gap-1 px-1">
      <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.order.requestHeading')}</h1>
      <p className="text-sm text-muted-foreground">{gig.title}</p>
    </header>
  );

  if (!verified) {
    return (
      <PageShell>
        <div className="flex flex-col gap-4">
          {header}
          <div className="ios-card flex flex-col items-start gap-3 rounded-2xl p-6">
            <p className="text-sm text-muted-foreground">{t('marketplace.order.verifyWall')}</p>
            <GetVerified />
          </div>
          <Link
            href={`${base}/services/${gigId}`}
            className="px-1 text-sm font-medium text-primary"
          >
            {t('marketplace.back')}
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        {header}
        <div className="ios-card flex flex-col gap-1 rounded-2xl p-4">
          <span className="text-sm font-semibold">{pkg.title}</span>
          <span className="text-lg font-bold">{formatPkr(pkg.pricePaisa)}</span>
          <span className="text-xs text-muted-foreground">
            {countText(tenant.locale, 'days', pkg.deliveryDays)} ·{' '}
            {countText(tenant.locale, 'revisions', pkg.revisions)}
          </span>
        </div>
        <OrderRequestForm
          base={base}
          tenant={slug}
          gigId={gigId}
          packageId={pkg.id}
          labels={{
            requirements: t('marketplace.order.requirements'),
            requirementsPlaceholder: t('marketplace.order.requirementsPlaceholder'),
            paymentMode: t('marketplace.order.paymentMode'),
            cash: t('marketplace.order.cash'),
            cashHint: t('marketplace.order.cashHint'),
            online: t('marketplace.order.online'),
            onlineHint: t('marketplace.order.onlineHint'),
            submit: t('marketplace.order.place'),
            submitting: t('marketplace.form.submitting'),
            failed: t('marketplace.form.failed'),
          }}
        />
        <Link href={`${base}/services/${gigId}`} className="px-1 text-sm font-medium text-primary">
          {t('marketplace.back')}
        </Link>
      </div>
    </PageShell>
  );
}
