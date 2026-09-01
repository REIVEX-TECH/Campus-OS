import { describe, expect, it } from 'vitest';
import { isPlatformHost, planRoute, tenantBaseForHost, tenantOrigin } from '../lib/tenant-routing';

// The nested-host model: a tenant is {slug}.TENANT_BASE_DOMAIN, nested under the
// platform root PLATFORM_HOST (which equals the bare tenant base). APP_DOMAIN is
// the LEGACY flat root, kept only to 308-redirect old {slug}.APP_DOMAIN hosts
// forward. Env is passed explicitly here so the tests do not depend on process.env.
const TENANT_BASE = 'campusos.reivex.io';
const PLATFORM = 'campusos.reivex.io';
const LEGACY = 'reivex.io';

describe('tenantBaseForHost', () => {
  it('returns an empty base on a tenant subdomain of the tenant base', () => {
    expect(tenantBaseForHost('lgu.campusos.reivex.io', 'lgu', TENANT_BASE, PLATFORM)).toBe('');
  });

  it('returns /u/{slug} on the path-based dev fallback and on the platform host', () => {
    expect(tenantBaseForHost('localhost:3000', 'lgu', 'localhost:3000', null)).toBe('/u/lgu');
    expect(tenantBaseForHost(PLATFORM, 'lgu', TENANT_BASE, PLATFORM)).toBe('/u/lgu');
  });
});

describe('planRoute: tenant subdomain of TENANT_BASE_DOMAIN', () => {
  it('rewrites a clean subdomain path onto the internal /u/{label} tree', () => {
    expect(
      planRoute('lgu.campusos.reivex.io', '/timetable', TENANT_BASE, PLATFORM, LEGACY),
    ).toEqual({ action: 'rewrite', pathname: '/u/lgu/timetable', slug: 'lgu' });
    expect(planRoute('lgu.campusos.reivex.io', '/', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'rewrite',
      pathname: '/u/lgu',
      slug: 'lgu',
    });
  });

  it('redirects a duplicate /u/{label} path to the canonical clean URL', () => {
    expect(
      planRoute(
        'lgu.campusos.reivex.io',
        '/u/lgu/admin/login/submit',
        TENANT_BASE,
        PLATFORM,
        LEGACY,
      ),
    ).toEqual({ action: 'redirect', pathname: '/admin/login/submit' });
    expect(planRoute('lgu.campusos.reivex.io', '/u/lgu', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'redirect',
      pathname: '/',
    });
  });

  it('still rewrites an UNKNOWN slug onto /u/{label} (the [slug] layout renders the 404)', () => {
    // planRoute stays pure (no registry); an unrecognised subdomain is rewritten
    // and the tenant layout notFound()s. The 404 is asserted end to end elsewhere.
    expect(planRoute('bogus.campusos.reivex.io', '/', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'rewrite',
      pathname: '/u/bogus',
      slug: 'bogus',
    });
  });
});

describe('planRoute: platform root', () => {
  it('isPlatformHost matches the platform host (port-insensitive), not tenants', () => {
    expect(isPlatformHost('campusos.reivex.io', PLATFORM)).toBe(true);
    expect(isPlatformHost('campusos.reivex.io:443', PLATFORM)).toBe(true);
    expect(isPlatformHost('lgu.campusos.reivex.io', PLATFORM)).toBe(false);
    expect(isPlatformHost('anything', null)).toBe(false);
  });

  it('serves the landing at / and treats the platform host as path-based tenant access', () => {
    expect(planRoute(PLATFORM, '/', TENANT_BASE, PLATFORM, LEGACY)).toEqual({ action: 'next' });
    expect(planRoute(PLATFORM, '/u/lgu/timetable', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'next',
      slug: 'lgu',
    });
  });

  it('treats the bare tenant base as the platform root even with PLATFORM_HOST unset', () => {
    // No leading label, so no tenant; and it must NOT fall into the legacy branch
    // (which would loop it to campusos.campusos.reivex.io).
    expect(planRoute(TENANT_BASE, '/', TENANT_BASE, null, LEGACY)).toEqual({ action: 'next' });
  });
});

describe('planRoute: legacy host 308', () => {
  it('redirects {slug}.APP_DOMAIN to {slug}.TENANT_BASE_DOMAIN, preserving the path', () => {
    expect(planRoute('lgu.reivex.io', '/timetable', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'redirect',
      pathname: '/timetable',
      host: 'lgu.campusos.reivex.io',
    });
    expect(planRoute('lgu.reivex.io', '/', TENANT_BASE, PLATFORM, LEGACY)).toEqual({
      action: 'redirect',
      pathname: '/',
      host: 'lgu.campusos.reivex.io',
    });
  });

  it('never redirects the platform host (a subdomain of the legacy root) to itself', () => {
    // The ordering guard keeps campusos.reivex.io on the platform, not looping.
    expect(planRoute(PLATFORM, '/', TENANT_BASE, PLATFORM, LEGACY)).toEqual({ action: 'next' });
    expect(planRoute(TENANT_BASE, '/', TENANT_BASE, null, LEGACY)).toEqual({ action: 'next' });
  });

  it('is inert when the legacy domain equals the tenant base (redirect disabled)', () => {
    expect(planRoute('lgu.campusos.reivex.io', '/x', TENANT_BASE, PLATFORM, TENANT_BASE)).toEqual({
      action: 'rewrite',
      pathname: '/u/lgu/x',
      slug: 'lgu',
    });
  });

  it('passes through the path-based dev fallback and non-tenant requests', () => {
    expect(
      planRoute('localhost:3000', '/u/lgu/admin/rooms', 'localhost:3000', null, 'localhost:3000'),
    ).toEqual({ action: 'next', slug: 'lgu' });
    expect(planRoute('localhost:3000', '/', 'localhost:3000', null, 'localhost:3000')).toEqual({
      action: 'next',
    });
  });
});

describe('tenantOrigin', () => {
  it('is the production subdomain of the tenant base', () => {
    expect(tenantOrigin('lgu', 'campusos.reivex.io')).toBe('https://lgu.campusos.reivex.io');
  });

  it('is null in local dev (tenants are path-based)', () => {
    expect(tenantOrigin('lgu', 'localhost:3000')).toBeNull();
    expect(tenantOrigin('lgu', '127.0.0.1:3000')).toBeNull();
  });
});
