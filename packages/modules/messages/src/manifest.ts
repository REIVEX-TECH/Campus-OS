import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after the other modules). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** This module's own bookkeeping table, so no other folder's dates interfere. */
export const migrationsTable = '__drizzle_migrations_messages';

/**
 * Tenant settings for direct messages. Messaging is a user-to-user feature, so
 * the defaults are conservative (verified-only) and every knob narrows, never
 * widens, what a stranger can do.
 */
export const settingsSchema = z.object({
  /**
   * Who may be messaged, and who may start a conversation:
   *  - 'verified' (default): only verified members, and only a verified member starts one;
   *  - 'anyone': any member may message any member;
   *  - 'nobody': messaging is off for the tenant.
   */
  whoCanMessage: z.enum(['verified', 'anyone', 'nobody']).default('verified'),
  /** Minutes after sending during which the sender may edit a message. */
  editWindowMinutes: z.number().int().min(0).max(60).default(5),
  /** Minutes after sending during which the sender may delete for everyone. */
  deleteEveryoneWindowMinutes: z.number().int().min(0).max(1440).default(60),
  /** Grace, in seconds, before an after-viewing message expires once first read. */
  afterViewingGraceSeconds: z.number().int().min(0).max(3600).default(60),
  /** Largest message body accepted, in characters. */
  maxBodyLength: z.number().int().min(1).max(10_000).default(4000),
  /** Messages one sender may send in a rolling minute. */
  messagesPerMinute: z.number().int().min(1).max(600).default(30),
  /** New conversations one person may start in a rolling day. */
  newConversationsPerDay: z.number().int().min(1).max(500).default(20),
});

export type MessagesSettings = z.infer<typeof settingsSchema>;

export const manifest: ModuleManifest = defineManifest({
  id: 'messages',
  version: '0.1.0',
  routes: [],
  navigation: [],
  // Sending and reading are gated on membership, the whoCanMessage setting and
  // blocks, not a role permission (any verified member may message). The only
  // role permission is moderation, added to the enforced catalogue and the
  // tenant_admin template with the moderation migration that checks it.
  permissions: [
    { id: 'messages.moderate', description: 'Read reported messages and resolve message reports' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder, table: migrationsTable },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
