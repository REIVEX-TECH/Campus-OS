import { defineConfig } from 'vitest/config';

// Unit tests cover the pure domain: ranking, comment paths, masking rules.
// Everything that touches a table is an integration test against Postgres
// (vitest.integration.config.ts), because the guarantees here are RLS and
// column privileges, which mean nothing without the real thing.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
