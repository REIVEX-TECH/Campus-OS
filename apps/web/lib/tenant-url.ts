import { headers } from 'next/headers';
import { tenantBaseForHost } from './tenant-routing';

/**
 * The URL base for tenant-relative links/form actions in the current request:
 * '' on a tenant subdomain (production), '/u/{slug}' on the path-based dev
 * fallback. Derived from the request Host header, so it matches how middleware
 * resolved the tenant. Use it for every internal link and form action.
 */
export async function tenantBase(slug: string): Promise<string> {
  const host = (await headers()).get('host') ?? '';
  return tenantBaseForHost(host, slug);
}
