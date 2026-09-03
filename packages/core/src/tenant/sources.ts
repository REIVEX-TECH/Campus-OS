import { tenantConfigSchema, type TenantConfig } from './schema';

/**
 * Where a tenant's configuration came from.
 *
 * The database is the source of truth; a file config is the fallback that keeps
 * a tenant serving while its row does not exist yet, and what a fresh checkout
 * runs on with no database at all. Per slug, a valid database row wins. An
 * invalid row is skipped and reported rather than thrown, so one bad edit in
 * the platform admin cannot take every tenant down: the file answers if there
 * is one, and the tenant is simply absent if there is not.
 */

export type TenantConfigSource = 'file' | 'database';

export interface DatabaseTenantConfig {
  slug: string;
  config: unknown;
}

export interface MergedTenantConfigs {
  configs: TenantConfig[];
  source: ReadonlyMap<string, TenantConfigSource>;
  /** Database rows that failed validation and were skipped, with what was wrong. */
  invalid: { slug: string; issues: string }[];
}

export function mergeTenantConfigs(input: {
  file: readonly unknown[];
  database: readonly DatabaseTenantConfig[];
}): MergedTenantConfigs {
  const bySlug = new Map<string, TenantConfig>();
  const source = new Map<string, TenantConfigSource>();
  const invalid: MergedTenantConfigs['invalid'] = [];

  // File configs are code: an invalid one throws at load, as it always has.
  for (const raw of input.file) {
    const config = tenantConfigSchema.parse(raw);
    bySlug.set(config.slug, config);
    source.set(config.slug, 'file');
  }

  for (const row of input.database) {
    const parsed = tenantConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      invalid.push({
        slug: row.slug,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      continue;
    }
    if (parsed.data.slug !== row.slug) {
      invalid.push({
        slug: row.slug,
        issues: `config names slug "${parsed.data.slug}", row is "${row.slug}"`,
      });
      continue;
    }
    bySlug.set(row.slug, parsed.data);
    source.set(row.slug, 'database');
  }

  return { configs: [...bySlug.values()], source, invalid };
}
