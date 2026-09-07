import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after the other modules). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_marketplace';

/** The default goods categories a tenant starts with; a tenant may edit the list. */
export const DEFAULT_CATEGORIES = [
  'textbooks',
  'electronics',
  'hostel-and-room',
  'clothing',
  'stationery',
  'tickets-and-passes',
  'other',
] as const;

/** The condition a goods listing may declare. */
export const CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Where a seller prefers to meet; free text, kept short. Cash on meetup only. */
export const MEETUP_MAX = 120;

/** Tenant settings for the marketplace (goods). Services and money add their own. */
export const settingsSchema = z.object({
  /** The categories a goods listing may be filed under. */
  categories: z
    .array(z.string().min(1).max(40))
    .min(1)
    .default([...DEFAULT_CATEGORIES]),
  /** Photos allowed per listing. */
  maxPhotosPerListing: z.number().int().min(1).max(6).default(6),
  /** Largest single upload accepted, in bytes. */
  maxUploadBytes: z
    .number()
    .int()
    .min(256 * 1024)
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  /** Largest price a listing may state, in paisa (PKR). Guards a typo, not policy. */
  maxPricePaisa: z.number().int().min(1).max(1_000_000_00).default(1_000_000_00),
  /** Open reports on one listing before it is hidden pending a moderator. */
  reportThreshold: z.number().int().min(2).max(20).default(3),
  /** Days an active listing lives before it auto-expires out of default browse. */
  expiryDays: z.number().int().min(7).max(365).default(30),
  /** Days a sold listing stays viewable before it hides. */
  soldVisibleDays: z.number().int().min(1).max(90).default(7),
});

export type MarketplaceSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'marketplace',
  version: '0.1.0',
  routes: [],
  navigation: [],
  // Posting is gated on verified membership in the write path (any verified member
  // may sell), not on a role permission. The only marketplace permission is
  // moderation; it is added to the enforced catalogue and granted to tenant_admin
  // with the moderation PR that checks it.
  permissions: [
    {
      id: 'marketplace.moderate',
      description: 'Remove listings, resolve reports, read listing reports',
    },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
