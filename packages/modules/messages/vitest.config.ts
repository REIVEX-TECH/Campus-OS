import { defineConfig } from 'vitest/config';

// This module ships its guarantees as RLS (participant-only visibility), which
// needs a real Postgres to mean anything (see vitest.integration.config.ts). The
// unit run excludes the integration tests so it does not reach for a database.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
