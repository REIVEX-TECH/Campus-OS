import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Folder holding the base (@campusos/db) migrations. */
export const baseMigrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/** Apply the migrations in `migrationsFolder` to `databaseUrl`, then disconnect. */
export async function applyMigrations(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

/** Apply the base tenant/RLS migrations. */
export function runBaseMigrations(databaseUrl: string): Promise<void> {
  return applyMigrations(databaseUrl, baseMigrationsFolder);
}
