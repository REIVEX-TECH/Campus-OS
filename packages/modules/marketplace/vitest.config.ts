import { defineConfig } from 'vitest/config';

// This module currently ships only integration tests (see
// vitest.integration.config.ts): its guarantees are RLS, which needs a real
// Postgres to mean anything. The unit run excludes them so it does not try to
// reach a database it has no URL for.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
