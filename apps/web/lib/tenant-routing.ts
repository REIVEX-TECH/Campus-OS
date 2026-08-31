import { subdomainOf } from '@campusos/core/tenant';

// Pure tenant-routing logic (no Next.js imports), so it is unit testable.
// A tenant is resolved either from the SUBDOMAIN (production: lgu.reivex.io) or
// from the /u/{slug} PATH (local dev). Internal links and form actions must use
// the matching base, and middleware must not double-prefix.

export function appDomain(): string {
  return process.env.APP_DOMAIN ?? 'localhost:3000';
}

/**
 * URL base for tenant-relative links and form actions: '' when the tenant
 * resolves from the subdomain (links are root-relative, e.g. `/admin/rooms`), or
 * `/u/{slug}` when it resolves from the path (local dev).
 */
export function tenantBaseForHost(
  host: string,
  slug: string,
  domain: string = appDomain(),
): string {
  return subdomainOf(host, domain) ? '' : `/u/${slug}`;
}

export type RoutePlan =
  | { action: 'redirect'; pathname: string }
  | { action: 'rewrite'; pathname: string; slug: string }
  | { action: 'next'; slug?: string };

/**
 * Decide how middleware handles a request:
 * - On a tenant subdomain, a `/u/{label}/...` path is a non-canonical duplicate
 *   of `/...`, so REDIRECT to the clean URL (one canonical shape; good for SEO,
 *   and it prevents the double-rewrite that produced /u/lgu/u/lgu/...).
 * - Otherwise on a subdomain, REWRITE the clean URL onto the internal
 *   /u/{label} route tree.
 * - Off a subdomain, a /u/{slug} path passes through (dev fallback).
 */
export function planRoute(host: string, pathname: string, domain: string = appDomain()): RoutePlan {
  const label = subdomainOf(host, domain);
  if (label) {
    const dupe = `/u/${label}`;
    if (pathname === dupe || pathname.startsWith(`${dupe}/`)) {
      return { action: 'redirect', pathname: pathname.slice(dupe.length) || '/' };
    }
    return {
      action: 'rewrite',
      pathname: `/u/${label}${pathname === '/' ? '' : pathname}`,
      slug: label,
    };
  }
  if (pathname.startsWith('/u/')) {
    const slug = pathname.split('/')[2] ?? '';
    return slug ? { action: 'next', slug } : { action: 'next' };
  }
  return { action: 'next' };
}
