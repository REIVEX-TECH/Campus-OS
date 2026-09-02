import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

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
