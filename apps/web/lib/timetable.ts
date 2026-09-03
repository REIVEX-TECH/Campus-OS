import { notFound } from 'next/navigation';
import type { TenantConfig } from '@campusos/core/tenant';
import { createTimetableQueries, type TimetableQueries } from '@campusos/module-timetable/read';
import { getTenantRegistry } from './tenants';

/** Resolve a tenant by slug or render the 404 page. */
export async function requireTenant(slug: string): Promise<TenantConfig> {
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) notFound();
  return tenant;
}

/** Tenant-scoped timetable read queries for the resolved slug. */
export function getQueries(slug: string): TimetableQueries {
  return createTimetableQueries(slug);
}
