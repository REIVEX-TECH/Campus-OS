import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/**
 * The tenant registry. A row IS a tenant, so this table is NOT tenant-scoped and
 * carries no `tenant_id`. `slug` is the immutable tenant key referenced by every
 * scoped table (see CLAUDE.md §4).
 */
export const universities = pgTable('universities', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  locale: text('locale').notNull().default('en'),
  ...timestamps,
});

export const campuses = pgTable(
  'campuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('campuses_tenant_idx').on(t.tenantId)],
);

export const buildings = pgTable(
  'buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('buildings_tenant_idx').on(t.tenantId),
    index('buildings_tenant_campus_idx').on(t.tenantId, t.campusId),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Normalized match key for dedup (see the timetable module's roomDedupKey):
    // the sink auto-creates one room per (tenant, dedup_key). Decoupled from the
    // renamable display `name`, so renaming a room never causes a re-crawl to
    // create a duplicate. Nullable for rooms created before this column existed;
    // the backfill populates them. Uniqueness is enforced by the partial index
    // below (excluding soft-deleted rooms, so a merged-away name can recur).
    dedupKey: text('dedup_key'),
    capacity: integer('capacity'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('rooms_tenant_idx').on(t.tenantId),
    index('rooms_tenant_building_idx').on(t.tenantId, t.buildingId),
    uniqueIndex('rooms_tenant_dedup_uq')
      .on(t.tenantId, t.dedupKey)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type University = typeof universities.$inferSelect;
export type NewUniversity = typeof universities.$inferInsert;
export type Campus = typeof campuses.$inferSelect;
export type Building = typeof buildings.$inferSelect;
export type Room = typeof rooms.$inferSelect;

/** Tables that carry `tenant_id` and must have FORCE ROW LEVEL SECURITY. */
export const tenantScopedTables = ['campuses', 'buildings', 'rooms'] as const;
