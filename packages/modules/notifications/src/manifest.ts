import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/**
 * The notifications module. Infrastructure, not a per-tenant feature: no routes, no
 * navigation, no settings. It owns the shared `notifications` table (the table was
 * first created by communities 0002; this module's migration takes ownership,
 * generalises it with a payload + link, and adds the generic emit definer that any
 * module calls). The bell and inbox UI live in apps/web.
 *
 * Migration ordering: this module's migration ALTERs the existing table, so it must
 * run after communities in migrate-all. Its integration test applies the
 * communities migrations first for the same reason.
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
export const migrationsTable = '__drizzle_migrations_notifications';

export const settingsSchema = z.object({});
export type NotificationsSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'notifications',
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
