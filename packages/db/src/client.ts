import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema/index';

// Validate DB config at the boundary (CLAUDE.md §5). The app talks to Postgres
// ONLY via DATABASE_URL, using the least-privilege campusos_app role.
const { DATABASE_URL } = z
  .object({ DATABASE_URL: z.string().url() })
  .parse({ DATABASE_URL: process.env.DATABASE_URL });

/**
 * Raw Postgres connection and Drizzle client.
 *
 * DO NOT import this from application code — go through a repository, which sets
 * the tenant context so RLS applies. An ESLint rule bans this import in apps/web.
 */
export const sqlClient = postgres(DATABASE_URL, { max: 10, prepare: false });

export const db = drizzle(sqlClient, { schema });

export type Db = typeof db;
