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
  const url = `${baseUrlFromHost(host)}${opts.path}`;
  const description = opts.description ?? opts.tenant.seo.description;
  return {
    title: opts.title,
    description,
    keywords: opts.tenant.seo.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: `${opts.title} · ${opts.tenant.displayName}`,
      description,
      url,
      siteName: opts.tenant.displayName,
      locale: opts.tenant.locale,
      type: 'website',
    },
  };
}
