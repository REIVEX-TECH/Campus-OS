import { describe, expect, it } from 'vitest';
import { mergeTenantConfigs } from '../src/tenant/sources';

const file = {
  slug: 'aaa',
  displayName: 'Alpha (file)',
  timezone: 'Asia/Karachi',
  locale: 'en',
  branding: { colors: { primary: '#0b5d3b' }, logoPath: '/x.svg' },
  seo: { titleTemplate: '%s · Alpha', description: 'Alpha.' },
};

describe('mergeTenantConfigs', () => {
  it('lets a valid database row win over the file for the same slug', () => {
    const merged = mergeTenantConfigs({
      file: [file],
      database: [{ slug: 'aaa', config: { ...file, displayName: 'Alpha (database)' } }],
    });
    expect(merged.configs.map((c) => c.displayName)).toEqual(['Alpha (database)']);
    expect(merged.source.get('aaa')).toBe('database');
    expect(merged.invalid).toEqual([]);
  });

  it('adds a tenant that exists only in the database', () => {
    const merged = mergeTenantConfigs({
      file: [file],
      database: [{ slug: 'bbb', config: { ...file, slug: 'bbb', displayName: 'Beta' } }],
    });
    expect(merged.configs.map((c) => c.slug).sort()).toEqual(['aaa', 'bbb']);
    expect(merged.source.get('bbb')).toBe('database');
  });

  it('skips an invalid row and falls back to the file, reporting what was wrong', () => {
    const merged = mergeTenantConfigs({
      file: [file],
      database: [{ slug: 'aaa', config: { ...file, branding: { colors: {}, logoPath: '' } } }],
    });
    expect(merged.configs.map((c) => c.displayName)).toEqual(['Alpha (file)']);
    expect(merged.source.get('aaa')).toBe('file');
    expect(merged.invalid).toHaveLength(1);
    expect(merged.invalid[0]!.slug).toBe('aaa');
    expect(merged.invalid[0]!.issues).toContain('branding');
  });

  it('refuses a row whose config names a different slug', () => {
    const merged = mergeTenantConfigs({
      file: [],
      database: [{ slug: 'ccc', config: { ...file, slug: 'aaa' } }],
    });
    expect(merged.configs).toEqual([]);
    expect(merged.invalid[0]!.issues).toContain('ccc');
  });

  it('serves the files alone when the database has nothing', () => {
    const merged = mergeTenantConfigs({ file: [file], database: [] });
    expect(merged.configs).toHaveLength(1);
    expect(merged.source.get('aaa')).toBe('file');
  });
});
