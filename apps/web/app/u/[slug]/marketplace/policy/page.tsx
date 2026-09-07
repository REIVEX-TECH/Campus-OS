import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/app/_components/page-shell';
import { translator } from '@/lib/i18n';
import { requireMarketplace } from '@/lib/marketplace';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

// The platform operator. Placeholder for the operator to edit before launch.
const OPERATOR = 'Reivex Technologies';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('marketplace.policy.heading'),
    path: `${await tenantBase(slug)}/marketplace/policy`,
  });
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default async function MarketplacePolicyPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);

  return (
    <PageShell>
      <div className="flex max-w-prose flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('marketplace.policy.heading')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('marketplace.policy.operator', { operator: OPERATOR })}
          </p>
        </header>

        <Section id="terms" title={t('marketplace.policy.termsTitle')}>
          <p>{t('marketplace.policy.termsBody', { operator: OPERATOR })}</p>
        </Section>

        <Section id="prohibited" title={t('marketplace.policy.prohibitedTitle')}>
          <p>{t('marketplace.policy.prohibitedBody')}</p>
        </Section>

        <Section id="fees" title={t('marketplace.policy.feesTitle')}>
          <p>{t('marketplace.policy.feesBody')}</p>
        </Section>

        <Section id="refunds" title={t('marketplace.policy.refundsTitle')}>
          <p>{t('marketplace.policy.refundsBody')}</p>
        </Section>

        <Link href={`${base}/marketplace`} className="text-sm font-medium text-primary">
          {t('marketplace.back')}
        </Link>
      </div>
    </PageShell>
  );
}
