import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load the repo-root .env so DATABASE_URL / TEST_DATABASE_URL are available when
// running `pnpm --filter @campusos/db test:integration` directly.
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

// Integration tests run against a real Postgres. The suite talks to the DB as
// campusos_app via DATABASE_URL, which we point at TEST_DATABASE_URL here.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      // Migrations and truncates run as the schema owner (docs/db-role-split.md).
      MIGRATION_DATABASE_URL:
        process.env.TEST_MIGRATION_DATABASE_URL ??
        process.env.MIGRATION_DATABASE_URL ??
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        '',
    },
  },
});
