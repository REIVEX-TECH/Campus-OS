import { describe, expect, it } from 'vitest';
import { isPlatformHost, planRoute, tenantBaseForHost } from '../lib/tenant-routing';

describe('tenantBaseForHost', () => {
  it('returns an empty base when the tenant is resolved from the subdomain', () => {
    expect(tenantBaseForHost('lgu.reivex.io', 'lgu', 'reivex.io')).toBe('');
  });

  it('returns /u/{slug} when the tenant is resolved from the path (dev)', () => {
    expect(tenantBaseForHost('localhost:3000', 'lgu', 'localhost:3000')).toBe('/u/lgu');
    // the apex domain is not a subdomain, so it is path-based too:
    expect(tenantBaseForHost('reivex.io', 'lgu', 'reivex.io')).toBe('/u/lgu');
  });
});

describe('planRoute', () => {
  const D = 'reivex.io';

  it('rewrites a clean subdomain path onto the internal /u/{label} tree', () => {
    expect(planRoute('lgu.reivex.io', '/admin/login', D)).toEqual({
      action: 'rewrite',
      pathname: '/u/lgu/admin/login',
      slug: 'lgu',
    });
    expect(planRoute('lgu.reivex.io', '/', D)).toEqual({
      action: 'rewrite',
      pathname: '/u/lgu',
      slug: 'lgu',
    });
  });

  it('redirects a duplicate /u/{label} path to the canonical clean URL on the subdomain', () => {
    expect(planRoute('lgu.reivex.io', '/u/lgu/admin/login/submit', D)).toEqual({
      action: 'redirect',
      pathname: '/admin/login/submit',
    });
    expect(planRoute('lgu.reivex.io', '/u/lgu', D)).toEqual({
      action: 'redirect',
      pathname: '/',
    });
  });

  it('passes through /u/{slug} in the path-based dev fallback', () => {
    expect(planRoute('localhost:3000', '/u/lgu/admin/rooms', 'localhost:3000')).toEqual({
      action: 'next',
      slug: 'lgu',
    });
  });

  it('passes through non-tenant requests', () => {
    expect(planRoute('localhost:3000', '/', 'localhost:3000')).toEqual({ action: 'next' });
  });
});

describe('platform host', () => {
  const D = 'reivex.io';
  const P = 'campusos.reivex.io';

  it('isPlatformHost matches the configured platform host (port-insensitive), not tenants', () => {
    expect(isPlatformHost('campusos.reivex.io', P)).toBe(true);
    expect(isPlatformHost('campusos.reivex.io:443', P)).toBe(true);
    expect(isPlatformHost('lgu.reivex.io', P)).toBe(false);
    expect(isPlatformHost('anything', null)).toBe(false);
  });

  it('serves the platform landing at / and never resolves the platform host as a tenant', () => {
    expect(planRoute(P, '/', D, P)).toEqual({ action: 'next' });
    // /u/{slug} on the platform host is still path-based tenant access:
    expect(planRoute(P, '/u/lgu/timetable', D, P)).toEqual({ action: 'next', slug: 'lgu' });
  });

  it('still resolves a real tenant subdomain when the platform host is configured', () => {
    expect(planRoute('lgu.reivex.io', '/timetable', D, P)).toEqual({
      action: 'rewrite',
      pathname: '/u/lgu/timetable',
      slug: 'lgu',
    });
  });

  it('tenant links from the platform host use the /u/{slug} path shape', () => {
    expect(tenantBaseForHost(P, 'lgu', D, P)).toBe('/u/lgu');
  });
});
