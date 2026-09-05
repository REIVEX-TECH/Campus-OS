import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { GrantBanner } from '@/app/_components/admin/grant-banner';
import { grantBannerLabels, grantModalLabels } from '@/lib/grant-labels';
import { translator } from '@/lib/i18n';
import { tenantAccess } from '@/lib/tenant-access';
import { getTenantRegistry } from '@/lib/tenants';

// The admin area is not for search engines: the login is publicly reachable (it
// is the entry point) but should never be indexed, and neither should anything
// behind it. `noindex, nofollow` covers every admin route. The sitemap already
// omits these pages; this stops a crawler that finds the URL from indexing it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Wraps every tenant-admin route. It resolves the access context once (shared
 * with the pages) and, when the actor is here on a platform grant, shows the
 * countdown banner so the borrowed, time-boxed context is never invisible. A
 * platform admin with no grant for this tenant is sent to /admin to open one; a
 * signed-out visitor is left to the page (the bare /admin forwards to sign in).
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await tenantAccess(slug);
  if (access.kind === 'redirect') redirect(`/admin?enter=${encodeURIComponent(slug)}`);
  if (access.kind !== 'grant') return <>{children}</>;

  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  const t = translator(tenant?.locale ?? 'en');
  return (
    <>
      <GrantBanner
        grantId={access.grant.grantId}
        tenantSlug={slug}
        tenantName={tenant?.displayName ?? slug}
        expiresAt={access.grant.expiresAt.toISOString()}
        reason={access.grant.reason}
        warnWithinSeconds={120}
        labels={grantBannerLabels(t)}
        modalLabels={grantModalLabels(t)}
      />
      {children}
    </>
  );
}
