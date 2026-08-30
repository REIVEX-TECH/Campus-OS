import { defineConfig } from 'drizzle-kit';

// Used by `drizzle-kit generate/studio`. Migrations in ./drizzle are the source
// of truth (they also contain the hand-written RLS policies, which the schema
// cannot express). Generate is a convenience for future schema diffs.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://campusos_app@localhost:5432/campusos_dev',
  },
  strict: true,
  verbose: true,
});
