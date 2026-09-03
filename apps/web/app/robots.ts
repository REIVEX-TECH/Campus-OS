import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { getTenantRegistry } from '@/lib/tenants';
import { baseUrlFromHost } from '../lib/tenant';
import { isPlatformHost, tenantBaseDomain } from '../lib/tenant-routing';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') ?? tenantBaseDomain();
  const baseUrl = baseUrlFromHost(host);
  // Both the platform root and a resolved tenant expose a sitemap.
  const known =
    isPlatformHost(host) ||
    (await getTenantRegistry()).resolveByHost(host, tenantBaseDomain()) !== null;

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    ...(known ? { sitemap: `${baseUrl}/sitemap.xml`, host: baseUrl } : {}),
  };
}
