import { subdomainOf } from '@campusos/core/tenant';

// Pure tenant-routing logic (no Next.js imports), so it is unit testable.
// A tenant is resolved either from the SUBDOMAIN (production: lgu.reivex.io) or
// from the /u/{slug} PATH (local dev). Internal links and form actions must use
// the matching base, and middleware must not double-prefix.

export function appDomain(): string {
  return process.env.APP_DOMAIN ?? 'localhost:3000';
}

/** The platform-root host (e.g. campusos.reivex.io), from env; null if unset. */
export function platformHost(): string | null {
  const h = process.env.PLATFORM_HOST;
  return h && h.length > 0 ? h : null;
}

function bareHost(host: string): string {
  return (host.split(':')[0] ?? '').toLowerCase();
}

/** Is this request on the platform root (not a tenant)? */
export function isPlatformHost(host: string, platform: string | null = platformHost()): boolean {
  return platform !== null && bareHost(host) === bareHost(platform);
}

/**
 * URL base for tenant-relative links and form actions: '' when the tenant
 * resolves from the subdomain (links are root-relative, e.g. `/admin/rooms`), or
 * `/u/{slug}` when it resolves from the path (local dev, or a tenant reached by
 * path from the platform host).
 */
export function tenantBaseForHost(
  host: string,
  slug: string,
  domain: string = appDomain(),
  platform: string | null = platformHost(),
): string {
  if (isPlatformHost(host, platform)) return `/u/${slug}`;
  return subdomainOf(host, domain) ? '' : `/u/${slug}`;
}

export type RoutePlan =
  | { action: 'redirect'; pathname: string }
  | { action: 'rewrite'; pathname: string; slug: string }
  | { action: 'next'; slug?: string };

/**
 * Decide how middleware handles a request:
 * - The PLATFORM host (campusos.reivex.io) is NOT a tenant: it is never resolved
 *   as a slug, so `/` serves the platform landing and `/u/{slug}` still works as
 *   path-based tenant access.
 * - On a tenant subdomain, a `/u/{label}/...` path is a non-canonical duplicate
 *   of `/...`, so REDIRECT to the clean URL (one canonical shape; good for SEO,
 *   and it prevents the double-rewrite that produced /u/lgu/u/lgu/...).
 * - Otherwise on a subdomain, REWRITE the clean URL onto the internal
 *   /u/{label} route tree.
 * - Off a subdomain, a /u/{slug} path passes through (dev fallback).
 */
export function planRoute(
  host: string,
  pathname: string,
  domain: string = appDomain(),
  platform: string | null = platformHost(),
): RoutePlan {
  // Treat the platform host as having no tenant label, so it falls through to
  // the /u/ path branch or serves the platform landing at '/'.
  const label = isPlatformHost(host, platform) ? null : subdomainOf(host, domain);
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
