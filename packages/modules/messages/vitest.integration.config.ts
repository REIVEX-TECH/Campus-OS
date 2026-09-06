import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Runs against a real Postgres via DATABASE_URL (pointed at TEST_DATABASE_URL),
// with migrations and truncates as the schema owner (docs/db-role-split.md).
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      MIGRATION_DATABASE_URL:
        process.env.TEST_MIGRATION_DATABASE_URL ??
        process.env.MIGRATION_DATABASE_URL ??
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        '',
    },
  },
});
