import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { z } from 'zod';
import * as schema from './schema/index';

export type Db = PostgresJsDatabase<typeof schema>;

// Lazily initialised so importing this module never validates env or opens a
// connection at import time. That keeps `next build` (which imports route
// modules to collect page data) working without DATABASE_URL, while runtime
// still validates on first use. App code must go through repositories, not this.
let sqlSingleton: Sql | undefined;
let dbSingleton: Db | undefined;

function connectionString(): string {
  return z.object({ DATABASE_URL: z.string().url() }).parse({
    DATABASE_URL: process.env.DATABASE_URL,
  }).DATABASE_URL;
}

/** The raw Postgres connection (created on first call). */
export function getSqlClient(): Sql {
  if (!sqlSingleton) sqlSingleton = postgres(connectionString(), { max: 10, prepare: false });
  return sqlSingleton;
}

/** The Drizzle client (created on first call). */
export function getDb(): Db {
  if (!dbSingleton) dbSingleton = drizzle(getSqlClient(), { schema });
  return dbSingleton;
}
