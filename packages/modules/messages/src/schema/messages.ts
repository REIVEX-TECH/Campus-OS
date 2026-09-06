import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * Direct messages: 1:1 conversations between two members of one tenant. Every
 * table carries `tenant_id` and is under RLS confined to the two participants
 * (drizzle/0000). References to people are plain uuids here (the FKs exist in
 * SQL); this module never imports another module's schema.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const conversations = pgTable(
  'msg_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** The two participants, stored ordered (a < b) so a pair maps to one row. */
    participantA: uuid('participant_a').notNull(),
    participantB: uuid('participant_b').notNull(),
    /** 'never' | 'after_24h' | 'after_viewing' — how messages here expire. */
    ephemerality: text('ephemerality').notNull().default('never'),
    lastMessageAt: tz('last_message_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('msg_conversations_pair_idx').on(t.tenantId, t.participantA, t.participantB),
    index('msg_conversations_a_idx').on(t.tenantId, t.participantA, t.lastMessageAt),
    index('msg_conversations_b_idx').on(t.tenantId, t.participantB, t.lastMessageAt),
  ],
);

export const participantState = pgTable(
  'msg_participant_state',
  {
    tenantId: text('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    participantId: uuid('participant_id').notNull(),
    /** Read receipt: everything up to here is read. */
    lastReadAt: tz('last_read_at'),
    /** Delete-for-me: this participant sees no message on or before here. */
    clearedAt: tz('cleared_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('msg_participant_state_pk').on(t.conversationId, t.participantId),
    index('msg_participant_state_person_idx').on(t.tenantId, t.participantId),
  ],
);

export const messages = pgTable(
  'msg_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    body: text('body').notNull(),
    /** Reply-to another message in the same conversation. */
    replyToId: uuid('reply_to_id'),
    /** Edited within the window; null if never edited. */
    editedAt: tz('edited_at'),
    /** Delete-for-everyone tombstone: the row stays, its body is cleared. */
    deletedAt: tz('deleted_at'),
    /** Ephemerality: when this message expires (null = never). */
    expiresAt: tz('expires_at'),
    /** First time the recipient viewed it, for after-viewing expiry. */
    firstViewedAt: tz('first_viewed_at'),
    createdAt,
  },
  (t) => [
    index('msg_messages_thread_idx').on(t.conversationId, t.createdAt, t.id),
    index('msg_messages_expiry_idx').on(t.tenantId, t.expiresAt),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type ParticipantState = typeof participantState.$inferSelect;
export type Message = typeof messages.$inferSelect;
