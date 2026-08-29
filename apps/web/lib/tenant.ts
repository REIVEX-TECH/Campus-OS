import { headers } from 'next/headers';
import type { TenantConfig } from '@campusos/core/tenant';
import { tenantRegistry } from '@campusos/tenants';

/** Resolve the current tenant from the request header set by middleware. */
export async function getCurrentTenant(): Promise<TenantConfig | null> {
  const slug = (await headers()).get('x-tenant-slug');
  return slug ? tenantRegistry.resolveBySlug(slug) : null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocal(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/** Build an absolute base URL from a request host (http for local, https else). */
export function baseUrlFromHost(host: string): string {
  const hostname = host.split(':')[0] ?? '';
  const protocol = isLocal(hostname) ? 'http' : 'https';
  return `${protocol}://${host}`;
}
