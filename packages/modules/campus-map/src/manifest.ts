import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations. */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_campus_map';

/** Tenant settings for the campus map. */
export const settingsSchema = z.object({
  /** Default render mode for a new campus map. */
  defaultMode: z.enum(['image', 'geo']).default('image'),
  /** Most points of interest a tenant may place. */
  maxPois: z.number().int().min(0).max(2000).default(200),
});

export type CampusMapSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'campus-map',
  version: '0.1.0',
  routes: [],
  navigation: [],
  // Browsing the map is tenant-wide public content; only managing it (placing
  // buildings and POIs, setting the campus image or geo config) is a role
  // permission. Granted to the tenant_admin template by this module's 0000 migration.
  permissions: [
    { id: 'map.manage', description: 'Manage the campus map: buildings, POIs, and layout' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
