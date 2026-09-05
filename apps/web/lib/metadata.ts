import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { TenantConfig } from '@campusos/core/tenant';
import { baseUrlFromHost } from './tenant';
import { tenantOrigin } from './tenant-routing';

const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

/**
 * Per-page metadata. The [slug] layout supplies the tenant title template
 * (tenant.seo.titleTemplate); `title` here is the page name it composes with.
 * NOTE: URLs use raw ids for now; human-readable slug paths
 * (/timetable/bscs/5/a) replace them once dimension data is verified.
 */
export async function pageMetadata(opts: {
  tenant: TenantConfig;
  title: string;
  description?: string;
  path: string;
  /** Keep this page out of search results, for pages that are nobody's business
   * but the reader's (an account page, an admin screen). */
  noIndex?: boolean;
}): Promise<Metadata> {
  // Canonical/OG origin is the tenant's canonical origin ({slug}.{base}), not the
  // request host, so it stays correct even if the page is served on a wrong host.
  // Falls back to the request host in dev/path mode, where there is no public base.
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const baseUrl = tenantOrigin(opts.tenant.slug) ?? baseUrlFromHost(host);
  const url = `${baseUrl}${opts.path}`;
  const description = opts.description ?? opts.tenant.seo.description;
  const ogTitle = `${opts.title} · ${opts.tenant.displayName}`;
  return {
    metadataBase: new URL(baseUrl),
    ...(opts.noIndex ? { robots: { index: false, follow: false } } : {}),
    title: opts.title,
    description,
    keywords: opts.tenant.seo.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: ogTitle,
      description,
      url,
      siteName: opts.tenant.displayName,
      locale: opts.tenant.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
    },
  };
}
