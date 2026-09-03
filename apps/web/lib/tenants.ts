import { cache } from 'react';
import {
  createTenantRegistry,
  mergeTenantConfigs,
  type TenantConfigSource,
  type TenantRegistry,
} from '@campusos/core/tenant';
import { listTenantConfigs } from '@campusos/db/repositories';
import { fileTenantConfigs } from '@campusos/tenants';

/**
 * The tenant registry: the database, with the file configs as fallback.
 *
 * Per slug a valid database row wins; a slug with no row is served from its
 * file, which is what keeps a tenant up while its row does not exist yet and
 * what a fresh checkout runs on with no database at all. An invalid row, or a
 * database that cannot be reached, is logged and served around rather than
 * thrown, because one bad edit must not take every university down.
 *
 * Cached per process for a short while and per request by React, so a page
 * pays at most one read and usually none. A write in this process invalidates
 * it; another process picks the change up within the window.
 */

const TTL_MS = 30_000;

interface Loaded {
  registry: TenantRegistry;
  source: ReadonlyMap<string, TenantConfigSource>;
  at: number;
}

let loaded: Loaded | null = null;

function fromFiles(): Loaded {
  const registry = createTenantRegistry(fileTenantConfigs);
  return {
    registry,
    source: new Map(registry.all().map((c) => [c.slug, 'file' as const])),
    at: Date.now(),
  };
}

async function load(): Promise<Loaded> {
  let rows: { slug: string; config: unknown }[] = [];
  try {
    rows = await listTenantConfigs();
  } catch (error) {
    console.error('[tenants] database unavailable, serving file configs', error);
    return fromFiles();
  }
  const merged = mergeTenantConfigs({ file: fileTenantConfigs, database: rows });
  for (const bad of merged.invalid) {
    console.error(`[tenants] ignoring invalid config for "${bad.slug}": ${bad.issues}`);
  }
  try {
    return {
      registry: createTenantRegistry(merged.configs),
      source: merged.source,
      at: Date.now(),
    };
  } catch (error) {
    // A duplicate slug or alias across tenants. The files are known good.
    console.error('[tenants] merged configs rejected, serving file configs', error);
    return fromFiles();
  }
}

async function current(): Promise<Loaded> {
  if (loaded && Date.now() - loaded.at < TTL_MS) return loaded;
  loaded = await load();
  return loaded;
}

export const getTenantRegistry = cache(
  async (): Promise<TenantRegistry> => (await current()).registry,
);

/** Where each tenant's configuration came from, for the platform admin. */
export const tenantConfigSources = cache(
  async (): Promise<ReadonlyMap<string, TenantConfigSource>> => (await current()).source,
);

/** Forget the cached registry, after a write in this process. */
export function invalidateTenantRegistry(): void {
  loaded = null;
}
