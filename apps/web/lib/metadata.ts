import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { TenantConfig } from '@campusos/core/tenant';
import { baseUrlFromHost } from './tenant';

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
}): Promise<Metadata> {
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const baseUrl = baseUrlFromHost(host);
  const url = `${baseUrl}${opts.path}`;
  const description = opts.description ?? opts.tenant.seo.description;
  const ogTitle = `${opts.title} · ${opts.tenant.displayName}`;
  return {
    metadataBase: new URL(baseUrl),
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
