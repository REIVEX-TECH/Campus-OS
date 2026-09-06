import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after the other modules). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_lost_found';

/** The default categories a tenant starts with; a tenant may edit the list. */
export const DEFAULT_CATEGORIES = [
  'electronics',
  'cards-and-ids',
  'keys',
  'bags',
  'clothing',
  'books',
  'other',
] as const;

/** Tenant settings for Lost & Found. */
export const settingsSchema = z.object({
  /** The categories an item may be filed under. */
  categories: z
    .array(z.string().min(1).max(40))
    .min(1)
    .default([...DEFAULT_CATEGORIES]),
  /** Photos allowed per item. */
  maxPhotosPerItem: z.number().int().min(1).max(10).default(5),
  /** Largest single upload accepted, in bytes. */
  maxUploadBytes: z
    .number()
    .int()
    .min(256 * 1024)
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  /** Open reports on one item before it is hidden pending a moderator. */
  reportThreshold: z.number().int().min(2).max(20).default(3),
  /** Days an open item lives before it auto-expires out of default browse. */
  expiryDays: z.number().int().min(7).max(365).default(90),
});

export type LostFoundSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'lost-found',
  version: '0.1.0',
  routes: [],
  navigation: [],
  // Posting an item and claiming one are gated on verified membership in the
  // write path, not on a role permission (any verified member may do them), so
  // the only Lost & Found permission is moderation. It is added to the enforced
  // catalogue and granted to tenant_admin with the moderation PR that checks it.
  permissions: [
    { id: 'lostfound.moderate', description: 'Remove items, resolve reports, read claim reports' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
