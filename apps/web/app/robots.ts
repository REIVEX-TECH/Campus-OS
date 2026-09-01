import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { tenantRegistry } from '@campusos/tenants';
import { baseUrlFromHost } from '../lib/tenant';
import { isPlatformHost } from '../lib/tenant-routing';

export const dynamic = 'force-dynamic';

const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const baseUrl = baseUrlFromHost(host);
  // Both the platform root and a resolved tenant expose a sitemap.
  const known = isPlatformHost(host) || tenantRegistry.resolveByHost(host, APP_DOMAIN) !== null;

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    ...(known ? { sitemap: `${baseUrl}/sitemap.xml`, host: baseUrl } : {}),
  };
}
