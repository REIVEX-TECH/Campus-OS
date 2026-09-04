import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after base and identity). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_communities';

/**
 * Tenant settings for communities, with the defaults from the design (§4).
 * Rate limits are per person per tenant.
 */
export const settingsSchema = z.object({
  readAccess: z.enum(['signedIn', 'public']).default('signedIn'),
  createCommunity: z.enum(['verified', 'approval']).default('verified'),
  anonymousPosting: z.enum(['on', 'off']).default('on'),
  commentDepth: z.number().int().min(2).max(12).default(8),
  pinnedPerCommunity: z.number().int().min(0).max(10).default(3),
  /** Open reports on one item before it is hidden pending a moderator. */
  reportThreshold: z.number().int().min(2).max(20).default(3),
  karmaVisible: z.boolean().default(false),
  /**
   * The most karma one account may give another in a day, in either direction.
   * A cap on the net, so changing a vote and changing it back costs nothing:
   * it stops a pair of accounts inflating each other and a grudge burying
   * anyone, without making an ordinary reader's votes stop counting.
   */
  karmaVotePerDayCap: z.number().int().min(1).max(100).default(10),
  /**
   * The floor under every community's participation gates (§12). A community
   * may ask for more and never for less, so raising one of these tightens the
   * whole university at once. `floorRequireVerified` stays on by default:
   * every write in this module already requires verification, and this is what
   * stops a community turning that off.
   */
  floorMinKarma: z.number().int().min(0).max(10_000).default(0),
  floorAccountAgeDays: z.number().int().min(0).max(365).default(0),
  floorRequireVerified: z.boolean().default(true),
  archiveAfterMonths: z.number().int().min(1).nullable().default(null),
});

export type CommunitiesSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'communities',
  version: '0.1.0',
  routes: [],
  navigation: [],
  permissions: [
    { id: 'communities.create', description: 'Create a community' },
    { id: 'communities.post', description: 'Post in a community' },
    { id: 'communities.comment', description: 'Comment in a community' },
    { id: 'communities.vote', description: 'Vote in a community' },
    { id: 'communities.moderate', description: 'Remove, approve, lock, pin, ban, mute' },
    { id: 'communities.flairs', description: 'Manage post and user flairs' },
    { id: 'communities.manage', description: 'Change community settings, rules and moderators' },
    { id: 'communities.transfer', description: 'Transfer ownership of a community' },
    { id: 'communities.oversee', description: 'Tenant wide moderation of every community' },
    { id: 'communities.unmask', description: 'Reveal an anonymous author, audited, from a report' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
