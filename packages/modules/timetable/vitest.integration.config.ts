import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Repository integration tests run against a real Postgres via DATABASE_URL
// (pointed at TEST_DATABASE_URL). The full DB path is also exercised end-to-end
// by the LGU ingest flow (see the adapter package).
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    passWithNoTests: true,
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
