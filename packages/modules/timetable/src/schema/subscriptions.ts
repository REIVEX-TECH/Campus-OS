import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sections } from './catalog';
import { subscriptionTarget } from './enums';
import { softDelete, tenantId } from './_shared';

// user_id is an opaque identifier for the platform user. It is deliberately NOT
// a cross-module FK (identity is a separate future module); integrity is
// enforced at the app layer (CLAUDE.md §4).

export const userSavedSections = pgTable(
  'user_saved_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ...softDelete,
  },
  (t) => [
    uniqueIndex('saved_sections_uq').on(t.tenantId, t.userId, t.sectionId),
    index('saved_sections_user_idx').on(t.tenantId, t.userId),
  ],
);

export const changeSubscriptions = pgTable(
  'change_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    targetType: subscriptionTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    channel: text('channel').notNull().default('email'),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ...softDelete,
  },
  (t) => [
    uniqueIndex('change_subs_uq').on(t.tenantId, t.userId, t.targetType, t.targetId),
    index('change_subs_target_idx').on(t.tenantId, t.targetType, t.targetId),
  ],
);
