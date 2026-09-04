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
  karmaVisible: z.boolean().default(false),
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
