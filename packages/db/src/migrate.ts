import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * The connection migrations run on.
 *
 * Schema changes are made by the OWNER role, not the application role. The two
 * are deliberately different: the application connects as a role that owns
 * nothing, so row-level security applies to it without relying on
 * FORCE, and it holds no DDL and no TRUNCATE (TRUNCATE ignores RLS, so an
 * application able to run it could empty every tenant at once).
 *
 * Falls back to DATABASE_URL so a database that has not been split yet, and a
 * developer who has not set the second variable, both keep working.
 */
export function migrationDatabaseUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to migrate');
  return url;
}

/**
 * Run maintenance statements as the migration role.
 *
 * Test setup only. Resetting tables needs TRUNCATE, which the application role
 * does not have and must not have, so the suites reach for this instead of
 * quietly widening the application's grants to suit the tests.
 */
export async function runAsMigrationRole(...statements: string[]): Promise<void> {
  const client = postgres(migrationDatabaseUrl(), { max: 1 });
  try {
    for (const statement of statements) await client.unsafe(statement);
  } finally {
    await client.end();
  }
}

/** Folder holding the base (@campusos/db) migrations. */
export const baseMigrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * Apply the migrations in `migrationsFolder` to `databaseUrl`, then disconnect.
 *
 * `migrationsTable` names the bookkeeping table. It matters more than it looks:
 * drizzle applies only migrations dated later than the last one recorded, so two
 * modules sharing a table will silently skip each other's work whenever one
 * module's folder is dated earlier than another's already-applied migration. Each
 * module therefore keeps its own table, and the default is left alone so existing
 * databases do not re-run anything.
 */
export async function applyMigrations(
  databaseUrl: string,
  migrationsFolder: string,
  migrationsTable?: string,
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder,
      ...(migrationsTable ? { migrationsTable } : {}),
    });
  } finally {
    await client.end();
  }
}

/** Apply the base tenant/RLS migrations. */
export function runBaseMigrations(databaseUrl: string): Promise<void> {
  return applyMigrations(databaseUrl, baseMigrationsFolder);
}
