import type { Metadata } from 'next';
import { translator } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('messages.heading'),
    path: `${await tenantBase(slug)}/messages`,
    noIndex: true,
  });
}

/** The messages screen is drawn by the layout; this route provides only its title. */
export default function MessagesPage() {
  return null;
}
