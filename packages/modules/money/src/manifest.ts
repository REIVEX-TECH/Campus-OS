import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/**
 * The money module. Platform-level infrastructure, not a per-tenant feature: it
 * has no routes, no navigation, and no tenant-facing settings. Tenant admins never
 * see finance (CLAUDE.md, overnight brief); the platform operates it on the
 * platform host. This package exists so the ledger has its own migration folder and
 * bookkeeping table, kept separate from any feature module.
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
export const migrationsTable = '__drizzle_migrations_money';

/** No tenant-facing settings: money is platform-level and always the same. */
export const settingsSchema = z.object({});
export type MoneySettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'money',
  version: '0.1.0',
  routes: [],
  navigation: [],
  permissions: [],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
