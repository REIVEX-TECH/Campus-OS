import { defineConfig } from 'vitest/config';

// Like the other RLS-first modules, rides ships integration tests (see
// vitest.integration.config.ts): its guarantees are RLS and cross-user access,
// which need a real Postgres. The unit run excludes them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
