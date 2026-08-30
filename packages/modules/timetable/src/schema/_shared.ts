import { text, timestamp } from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/** tenant_id column: text slug FK to the tenant registry (CLAUDE.md §4). */
export const tenantId = () =>
  text('tenant_id')
    .notNull()
    .references(() => universities.slug, { onDelete: 'cascade' });

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Dimension tables soft-delete rather than hard-delete (CLAUDE.md ingestion). */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
