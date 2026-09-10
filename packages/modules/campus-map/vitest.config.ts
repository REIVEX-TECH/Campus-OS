import { defineConfig } from 'vitest/config';

// Campus map is RLS-first like the other content modules: its guarantee is tenant
// isolation on a real Postgres, so the meaningful tests are integration (see
// vitest.integration.config.ts). The unit run excludes them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
