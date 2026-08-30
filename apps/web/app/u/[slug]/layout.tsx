import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return { title: 'Not found' };
  return {
    title: { default: tenant.displayName, template: tenant.seo.titleTemplate },
    description: tenant.seo.description,
    keywords: tenant.seo.keywords,
  };
}

export default async function TenantLayout({ children, params }: Params & { children: ReactNode }) {
  const { slug } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) notFound();
  return <div data-tenant={tenant.slug}>{children}</div>;
}
