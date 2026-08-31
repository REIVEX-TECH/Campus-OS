import { describe, expect, it } from 'vitest';
import { planRoute, tenantBaseForHost } from '../lib/tenant-routing';

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
