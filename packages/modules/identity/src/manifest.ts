import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after base db migrations). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own migration bookkeeping, kept separate from every other. */
export const migrationsTable = '__drizzle_migrations_identity';

export const settingsSchema = z.object({});

/**
 * Identity contributes no routes yet: this first slice is the data model and its
 * isolation guarantees only. Sign in, handles, and the access guard follow in
 * later slices, each behind its own review.
 */
export const manifest: ModuleManifest = defineManifest({
  id: 'identity',
  version: '0.1.0',
  routes: [],
  navigation: [],
  permissions: [
    { id: 'identity.self.read', description: 'Read your own account' },
    { id: 'identity.self.update', description: 'Change your own handle and avatar' },
    { id: 'identity.members.read', description: 'List the members of a tenant' },
    { id: 'identity.members.manage', description: 'Invite and remove tenant members' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
