import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after the other modules). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_rides';

/** Tenant settings for Rides. */
export const settingsSchema = z.object({
  /** Most seats an offer may advertise. */
  maxSeatsPerOffer: z.number().int().min(1).max(8).default(6),
  /** Longest free-text note on a ride. */
  notesMaxLength: z.number().int().min(0).max(2000).default(500),
  /** Open reports on one ride before it is hidden pending a moderator. */
  reportThreshold: z.number().int().min(2).max(20).default(3),
  /** Hours after departure a ride auto-completes (or expires with no riders). */
  completeAfterHours: z.number().int().min(1).max(24).default(2),
});

export type RidesSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'rides',
  version: '0.1.0',
  routes: [],
  navigation: [],
  // Posting a ride and requesting a seat are gated on verified membership in the
  // write path (any verified member may do them), so the only role permission is
  // moderation. It is added to the enforced catalogue and granted to tenant_admin
  // by the moderation migration that checks it.
  permissions: [{ id: 'rides.moderate', description: 'Remove rides, resolve ride reports' }],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
