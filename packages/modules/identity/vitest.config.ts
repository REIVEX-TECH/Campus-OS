import { defineConfig } from 'vitest/config';

// This module currently ships only integration tests (see
// vitest.integration.config.ts): its value is the isolation guarantees, which
// need a real Postgres to mean anything.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
