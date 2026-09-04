import { subdomainOf } from '@campusos/core/tenant';

// Pure tenant-routing logic (no Next.js imports), so it is unit testable.
// A tenant is resolved either from the SUBDOMAIN of TENANT_BASE_DOMAIN
// (production: lgu.campusos.reivex.io) or from the /u/{slug} PATH (local dev).
// Internal links and form actions must use the matching base, and middleware
// must not double-prefix.

/**
 * The LEGACY root domain (e.g. reivex.io). Kept ONLY so requests on the old flat
 * form {slug}.APP_DOMAIN (lgu.reivex.io) can be 308-redirected to the nested
 * form under TENANT_BASE_DOMAIN. Unset it (or set it equal to TENANT_BASE_DOMAIN)
 * to remove the legacy redirect.
 */
export function appDomain(): string {
  return process.env.APP_DOMAIN ?? 'localhost:3000';
}

/**
 * The base domain tenant subdomains nest under: a tenant is
 * {slug}.TENANT_BASE_DOMAIN (e.g. lgu.campusos.reivex.io). Falls back to
 * APP_DOMAIN, then localhost, so the app keeps resolving tenants on the current
 * host until TENANT_BASE_DOMAIN is configured (the migration is inert until set).
 */
export function tenantBaseDomain(): string {
  return process.env.TENANT_BASE_DOMAIN ?? process.env.APP_DOMAIN ?? 'localhost:3000';
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

/** Is the host a local-dev host (so tenants are reached by /u/{slug} path)? */
function isLocalHost(host: string): boolean {
  const h = bareHost(host);
  return h === 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') || h === '::1';
}

/**
 * A tenant's absolute origin: `https://{slug}.{TENANT_BASE_DOMAIN}`.
 *
 * Built from the configured tenant base domain, NOT the request host, so it is
 * the SAME on whatever host it renders on. That deterministic base is the fix for
 * the `{slug}.{slug}.*` doubling class: the previous host-reflective form
 * (`{slug}.{host}`) doubled to `lgu.lgu.campusos.reivex.io` whenever a page that
 * emits tenant links was itself served on a tenant host (e.g. the platform
 * landing rendered on `lgu.…` because a missing TENANT_BASE_DOMAIN broke tenant
 * detection).
 *
 * IDEMPOTENT: if the base already carries the slug (a misconfigured base, or a
 * tenant host passed in), the slug is not prepended again - this single guard
 * makes doubling unrepresentable for every emitter that goes through here.
 *
 * FAIL SAFE + LOUD: returns null when there is no usable PUBLIC base domain
 * (local dev, or an absent/misconfigured TENANT_BASE_DOMAIN that fell back to
 * localhost) so callers emit the path form `/u/{slug}` rather than a wrong
 * absolute host; in production it also logs, because reaching here with no public
 * base is a deployment misconfiguration, not a normal state.
 */
export function tenantOrigin(slug: string, base: string = tenantBaseDomain()): string | null {
  const s = slug.toLowerCase();
  const bare = bareHost(base);
  if (!bare || isLocalHost(base)) {
    if ((process.env.NODE_ENV ?? '') === 'production') {
      console.error(
        `tenantOrigin("${slug}"): no public TENANT_BASE_DOMAIN configured ` +
          `(base="${base}"); emitting the /u/${slug} path form. Set TENANT_BASE_DOMAIN.`,
      );
    }
    return null;
  }
  if (bare === s) return `https://${base}`;
  // Idempotent: if the base already leads with the slug (a tenant host passed in,
  // or a base that is itself already doubled), strip every leading `{slug}.` group
  // so the slug appears exactly once. This makes `{slug}.{slug}.*` unrepresentable
  // for any base, not just the single-prepend case.
  if (bare.startsWith(`${s}.`)) {
    const prefix = `${s}.`;
    let b = base;
    while (b.toLowerCase().startsWith(prefix + prefix)) b = b.slice(prefix.length);
    return `https://${b}`;
  }
  return `https://${s}.${base}`;
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
  tenantBase: string = tenantBaseDomain(),
  platform: string | null = platformHost(),
): string {
  if (isPlatformHost(host, platform)) return `/u/${slug}`;
  return subdomainOf(host, tenantBase) ? '' : `/u/${slug}`;
}

export type RoutePlan =
  | { action: 'redirect'; pathname: string; host?: string }
  | { action: 'rewrite'; pathname: string; slug: string }
  | { action: 'next'; slug?: string };

/**
 * Decide how middleware handles a request:
 * - The PLATFORM host (campusos.reivex.io) is NOT a tenant: it is never resolved
 *   as a slug, so `/` serves the platform landing and `/u/{slug}` still works as
 *   path-based tenant access. The bare TENANT_BASE_DOMAIN is the same host, so it
 *   is treated as the platform root too, even if PLATFORM_HOST is unset.
 * - On a tenant subdomain of TENANT_BASE_DOMAIN, a `/u/{label}/...` path is a
 *   non-canonical duplicate of `/...`, so REDIRECT to the clean URL; otherwise
 *   REWRITE the clean URL onto the internal /u/{label} route tree. An unknown
 *   label still rewrites onto /u/{label}, where the [slug] layout renders the
 *   styled 404 (planRoute stays pure, with no registry lookup).
 * - LEGACY host: a subdomain of the old APP_DOMAIN (and not the platform/base)
 *   308-redirects, cross-host, to {slug}.TENANT_BASE_DOMAIN, preserving the path.
 *   This branch runs AFTER the platform/tenant-base checks so the platform host
 *   (itself a subdomain of the legacy root) never loops.
 * - Off a subdomain, a /u/{slug} path passes through (dev fallback).
 */
export function planRoute(
  host: string,
  pathname: string,
  tenantBase: string = tenantBaseDomain(),
  platform: string | null = platformHost(),
  legacy: string = appDomain(),
): RoutePlan {
  const onPlatform = isPlatformHost(host, platform);

  // Tenant subdomain of the tenant base (the platform host has no label).
  const label = onPlatform ? null : subdomainOf(host, tenantBase);
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

  // Legacy host: 308 the old {slug}.APP_DOMAIN forward to {slug}.TENANT_BASE_DOMAIN.
  // Guarded so it never fires for the platform host or the bare tenant base (both
  // of which are subdomains of the legacy root and would otherwise loop), and so
  // it is inert when the legacy domain is not configured distinctly.
  if (
    !onPlatform &&
    bareHost(legacy) !== bareHost(tenantBase) &&
    bareHost(host) !== bareHost(tenantBase)
  ) {
    const legacyLabel = subdomainOf(host, legacy);
    if (legacyLabel) {
      return { action: 'redirect', pathname, host: `${legacyLabel}.${tenantBase}` };
    }
  }

  if (pathname.startsWith('/u/')) {
    const slug = pathname.split('/')[2] ?? '';
    return slug ? { action: 'next', slug } : { action: 'next' };
  }
  return { action: 'next' };
}
