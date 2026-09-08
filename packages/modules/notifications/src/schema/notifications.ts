import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The shared notifications table, as this module sees it after taking ownership
 * (drizzle/0000). It is the same physical table communities first created; this
 * definition adds the generic `payload` and `link` and treats the legacy
 * community/post/comment columns as opaque nullable uuids (no cross-module FK
 * import). A generic notification carries a `kind`, an optional display `payload`,
 * and an optional in-app `link`; communities notifications keep their own columns.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    actorId: uuid('actor_id'),
    /** Generic display fields, written by notifications_emit. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    link: text('link'),
    /** Legacy communities columns; null for a generic notification. */
    communityId: uuid('community_id'),
    postId: uuid('post_id'),
    commentId: uuid('comment_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_inbox_idx').on(t.tenantId, t.userId, t.createdAt, t.id)],
);

export type Notification = typeof notifications.$inferSelect;
