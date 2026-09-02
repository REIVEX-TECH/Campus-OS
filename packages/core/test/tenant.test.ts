import { describe, expect, it } from 'vitest';
import { createTenantRegistry, subdomainOf, tenantConfigSchema } from '../src/tenant/index';

const valid = {
  slug: 'lgu',
  displayName: 'Lahore Garrison University',
  aliases: ['lgu-main'],
  timezone: 'Asia/Karachi',
  locale: 'en',
  branding: { colors: { primary: '#0a7cff' }, logoPath: '/tenants/lgu/logo.svg' },
  allowedEmailDomains: ['lgu.edu.pk'],
  enabledModules: ['timetable'],
  seo: {
    titleTemplate: '%s · LGU Timetable',
    description: 'Class timetables for Lahore Garrison University.',
    keywords: ['lgu', 'timetable'],
    aliases: ['lgu.edu.pk'],
  },
};

describe('tenantConfigSchema', () => {
  it('accepts a valid config and applies defaults', () => {
    const parsed = tenantConfigSchema.parse({ ...valid, aliases: undefined });
    expect(parsed.aliases).toEqual([]);
    expect(parsed.enabledModules).toContain('timetable');
  });

  it('rejects an invalid slug', () => {
    expect(() => tenantConfigSchema.parse({ ...valid, slug: 'LGU Main' })).toThrow();
  });

  it('rejects a non-hex brand colour', () => {
    expect(() =>
      tenantConfigSchema.parse({
        ...valid,
        branding: { ...valid.branding, colors: { primary: 'blue' } },
      }),
    ).toThrow();
  });

  it('requires the %s placeholder in the SEO title template', () => {
    expect(() =>
      tenantConfigSchema.parse({ ...valid, seo: { ...valid.seo, titleTemplate: 'LGU Timetable' } }),
    ).toThrow();
  });
});

describe('subdomainOf', () => {
  it('extracts the subdomain label, ignoring port and case', () => {
    expect(subdomainOf('LGU.localhost:3000', 'localhost:3000')).toBe('lgu');
  });
  it('returns null for the root domain and www', () => {
    expect(subdomainOf('localhost:3000', 'localhost:3000')).toBeNull();
    expect(subdomainOf('www.localhost:3000', 'localhost:3000')).toBeNull();
  });
  it('returns null for an unrelated host', () => {
    expect(subdomainOf('example.com', 'localhost:3000')).toBeNull();
  });
});

describe('createTenantRegistry', () => {
  const registry = createTenantRegistry([valid]);

  it('resolves by slug and alias', () => {
    expect(registry.resolveBySlug('lgu')?.slug).toBe('lgu');
    expect(registry.resolveBySlug('lgu-main')?.slug).toBe('lgu');
    expect(registry.resolveBySlug('unknown')).toBeNull();
  });

  it('resolves by host subdomain and rejects unknown/root hosts', () => {
    expect(registry.resolveByHost('lgu.localhost:3000', 'localhost:3000')?.slug).toBe('lgu');
    expect(registry.resolveByHost('nope.localhost:3000', 'localhost:3000')).toBeNull();
    expect(registry.resolveByHost('localhost:3000', 'localhost:3000')).toBeNull();
  });

  it('throws on a duplicate slug/alias', () => {
    expect(() =>
      createTenantRegistry([valid, { ...valid, slug: 'other', aliases: ['lgu'] }]),
    ).toThrow();
  });
});

describe('joinMode', () => {
  it('defaults to domain, matching how the first tenant already works', () => {
    const parsed = tenantConfigSchema.parse({
      slug: 'aaa',
      displayName: 'Alpha U',
      timezone: 'Asia/Karachi',
      locale: 'en',
      branding: { colors: { primary: '#0a7cff' }, logoPath: '/logo.svg' },
      seo: { titleTemplate: '%s · Alpha', description: 'Alpha U' },
    });
    expect(parsed.joinMode).toBe('domain');
  });

  it('accepts invite for a tenant that would rather approve members', () => {
    const parsed = tenantConfigSchema.parse({
      slug: 'bbb',
      displayName: 'Beta U',
      timezone: 'Asia/Karachi',
      locale: 'en',
      joinMode: 'invite',
      branding: { colors: { primary: '#0a7cff' }, logoPath: '/logo.svg' },
      seo: { titleTemplate: '%s · Beta', description: 'Beta U' },
    });
    expect(parsed.joinMode).toBe('invite');
  });

  it('rejects a mode that is not one of the two', () => {
    expect(() =>
      tenantConfigSchema.parse({
        slug: 'ccc',
        displayName: 'Gamma U',
        timezone: 'Asia/Karachi',
        locale: 'en',
        joinMode: 'anyone',
        branding: { colors: { primary: '#0a7cff' }, logoPath: '/logo.svg' },
        seo: { titleTemplate: '%s · Gamma', description: 'Gamma U' },
      }),
    ).toThrow();
  });
});
