import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ingestionStatus, unmappedStatus } from './enums';
import { tenantId } from './_shared';

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    source: text('source').notNull(),
    status: ingestionStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // { inserted, closed, unchanged, unknown }
    stats: jsonb('stats').notNull().default({}),
    error: text('error'),
  },
  (t) => [index('ingestion_runs_tenant_started_idx').on(t.tenantId, t.startedAt)],
);

export const sourceSnapshots = pgTable(
  'source_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ingestionRunId: uuid('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: 'cascade' }),
    sourceRef: text('source_ref'),
    payload: jsonb('payload').notNull(),
    contentHash: text('content_hash').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('source_snapshots_run_idx').on(t.tenantId, t.ingestionRunId)],
);

/** Unknown source values held for admin review, instead of failing or dropping. */
export const unmappedSourceValues = pgTable(
  'unmapped_source_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    rawValue: text('raw_value').notNull(),
    normalizedGuess: text('normalized_guess'),
    resolvedId: uuid('resolved_id'),
    status: unmappedStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('unmapped_tenant_kind_value_uq').on(t.tenantId, t.kind, t.rawValue),
    index('unmapped_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type NewIngestionRun = typeof ingestionRuns.$inferInsert;
export type UnmappedSourceValue = typeof unmappedSourceValues.$inferSelect;
