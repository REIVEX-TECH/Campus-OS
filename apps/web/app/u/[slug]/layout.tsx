import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { tenantRegistry } from '@campusos/tenants';
import { AppShell } from '@/app/_components/app-shell';
import { accentStyle } from '@/lib/branding';
import { tenantBase } from '@/lib/tenant-url';

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
  const base = await tenantBase(slug);
  // Inject the tenant accent server-side (no FOUC). Overrides --primary for the
  // whole subtree; tokens cascade from here. The `.dark [data-tenant]` rule swaps
  // in the lightened accent for dark mode.
  return (
    <div data-tenant={tenant.slug} style={accentStyle(tenant.branding.colors.primary)}>
      <AppShell tenantName={tenant.displayName} base={base} locale={tenant.locale}>
        {children}
      </AppShell>
    </div>
  );
}
