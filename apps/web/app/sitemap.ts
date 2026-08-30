import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { tenantRegistry } from '@campusos/tenants';
import { baseUrlFromHost } from '../lib/tenant';

export const dynamic = 'force-dynamic';

const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const tenant = tenantRegistry.resolveByHost(host, APP_DOMAIN);
  if (!tenant) return [];

  const baseUrl = baseUrlFromHost(host);
  return [{ url: `${baseUrl}/`, lastModified: new Date(), changeFrequency: 'daily', priority: 1 }];
}
