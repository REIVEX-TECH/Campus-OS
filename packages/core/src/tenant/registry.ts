import { type TenantConfig, tenantConfigSchema } from './schema';

export interface TenantRegistry {
  /** All configured tenants. */
  all(): TenantConfig[];
  /** Resolve a tenant by its slug or any of its slug aliases. */
  resolveBySlug(slug: string): TenantConfig | null;
  /**
   * Resolve a tenant from a request host. Returns the tenant when the host is a
   * subdomain of `appDomain` ({slug}.appDomain), or null for the root domain or
   * an unknown subdomain. Port and case are ignored.
   */
  resolveByHost(host: string, appDomain: string): TenantConfig | null;
}

function hostname(value: string): string {
  return value.split(':')[0]?.toLowerCase() ?? '';
}

/** Extract the leading subdomain label of `host` relative to `appDomain`. */
export function subdomainOf(host: string, appDomain: string): string | null {
  const h = hostname(host);
  const base = hostname(appDomain);
  if (!h || !base || h === base || h === `www.${base}`) return null;
  if (h.endsWith(`.${base}`)) {
    const label = h.slice(0, -(base.length + 1)).split('.')[0];
    return label && label !== 'www' ? label : null;
  }
  return null;
}

/**
 * Build a tenant registry from raw config objects. Each config is validated with
 * `tenantConfigSchema`; an invalid config throws (fail fast at load). Duplicate
 * slugs/aliases across tenants also throw.
 */
export function createTenantRegistry(configs: readonly unknown[]): TenantRegistry {
  const bySlug = new Map<string, TenantConfig>();
  const list: TenantConfig[] = [];

  for (const raw of configs) {
    const config = tenantConfigSchema.parse(raw);
    list.push(config);
    for (const key of [config.slug, ...config.aliases]) {
      if (bySlug.has(key)) {
        throw new Error(`Duplicate tenant slug/alias "${key}" (tenant "${config.slug}")`);
      }
      bySlug.set(key, config);
    }
  }

  return {
    all: () => [...list],
    resolveBySlug: (slug) => bySlug.get(slug.toLowerCase()) ?? null,
    resolveByHost(host, appDomain) {
      const label = subdomainOf(host, appDomain);
      return label ? (bySlug.get(label) ?? null) : null;
    },
  };
}
