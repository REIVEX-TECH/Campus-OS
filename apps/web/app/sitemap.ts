import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { tenantRegistry } from '@campusos/tenants';
import { getQueries } from '@/lib/timetable';
import { baseUrlFromHost } from '@/lib/tenant';
import { isPlatformHost, tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

function instanceUrl(baseUrl: string, slug: string): string {
  const local = APP_DOMAIN.startsWith('localhost') || APP_DOMAIN.startsWith('127.');
  return local ? `${baseUrl}/u/${slug}` : `https://${slug}.${APP_DOMAIN}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') ?? APP_DOMAIN;
  const baseUrl = baseUrlFromHost(host);
  const now = new Date();

  // Platform root: the platform home + each tenant's instance.
  if (isPlatformHost(host)) {
    return [
      { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
      ...tenantRegistry.all().map((tnt) => ({
        url: instanceUrl(baseUrl, tnt.slug),
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  }

  // Tenant host: the tenant home, picker, and every section timetable.
  const tenant = tenantRegistry.resolveByHost(host, APP_DOMAIN);
  if (!tenant) return [];

  const base = `${baseUrl}${tenantBaseForHost(host, tenant.slug)}`;
  const queries = getQueries(tenant.slug);
  const terms = await queries.listTerms();
  const sectionLists = await Promise.all(terms.map((term) => queries.listSectionsByTerm(term.id)));

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/timetable`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
  ];
  for (const sections of sectionLists) {
    for (const section of sections) {
      entries.push({
        url: `${base}/sections/${section.id}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }
  return entries;
}
