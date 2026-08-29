import { defineConfig } from 'vitest/config';

// Unit tests only. Integration tests (require Postgres) use
// vitest.integration.config.ts and are excluded here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
