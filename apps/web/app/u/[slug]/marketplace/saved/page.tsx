import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { savedListings } from '@campusos/module-marketplace/listings';
import { ListingCard } from '@/app/_components/marketplace/listing-card';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { conditionLabels, requireMarketplace } from '@/lib/marketplace';
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
    title: translator(tenant.locale)('marketplace.savedPage.heading'),
    path: `${await tenantBase(slug)}/marketplace/saved`,
  });
}

export default async function SavedListingsPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMarketplace(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const items = await savedListings(actor.userId, slug);
  const cardLabels = {
    free: t('marketplace.price.free'),
    negotiable: t('marketplace.card.negotiable'),
    conditionLabels: conditionLabels(t),
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-4">
        <h1 className="px-1 text-2xl font-bold tracking-tight">
          {t('marketplace.savedPage.heading')}
        </h1>
        {items.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            {t('marketplace.savedPage.empty')}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} base={base} labels={cardLabels} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
