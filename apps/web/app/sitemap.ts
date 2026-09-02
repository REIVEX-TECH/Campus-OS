import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { tenantRegistry } from '@campusos/tenants';
import { MODULES } from '@/lib/modules';
import { getQueries } from '@/lib/timetable';
import { baseUrlFromHost } from '@/lib/tenant';
import {
  isPlatformHost,
  tenantBaseDomain,
  tenantBaseForHost,
  tenantUrlForHost,
} from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

// Host-reflective: a tenant instance is a subdomain of the platform host this
// sitemap is served on (single hop), or the /u/{slug} path in local dev.
function instanceUrl(host: string, baseUrl: string, slug: string): string {
  return tenantUrlForHost(slug, host) ?? `${baseUrl}/u/${slug}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') ?? tenantBaseDomain();
  const baseUrl = baseUrlFromHost(host);
  const now = new Date();

  // Platform root: the platform home + each tenant's instance.
  if (isPlatformHost(host)) {
    return [
      { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
      ...tenantRegistry.all().map((tnt) => ({
        url: instanceUrl(host, baseUrl, tnt.slug),
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  }

  // Tenant host: the tenant home, picker, and every section timetable.
  const tenant = tenantRegistry.resolveByHost(host, tenantBaseDomain());
  if (!tenant) return [];

  const base = `${baseUrl}${tenantBaseForHost(host, tenant.slug)}`;
  const queries = getQueries(tenant.slug);
  const terms = await queries.listTerms();
  const [sectionLists, teacherIds, roomIds, courseIds] = await Promise.all([
    Promise.all(terms.map((term) => queries.listSectionsByTerm(term.id))),
    queries.listTeacherIdsWithEntries(),
    queries.listRoomIdsWithEntries(),
    queries.listCourseIdsWithEntries(),
  ]);

  // Static public pages of the tenant.
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/timetable`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/free-rooms`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/search`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/teachers`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/rooms`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
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
  for (const { id } of courseIds) {
    entries.push({
      url: `${base}/courses/${id}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }
  for (const { id } of teacherIds) {
    entries.push({
      url: `${base}/teachers/${id}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.5,
    });
  }
  for (const { id } of roomIds) {
    entries.push({
      url: `${base}/rooms/${id}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.5,
    });
  }
  // The "coming soon" module stubs are public, low-priority pages.
  for (const mod of MODULES) {
    if (mod.soon) {
      entries.push({
        url: `${base}/soon/${mod.key}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.2,
      });
    }
  }
  return entries;
}
