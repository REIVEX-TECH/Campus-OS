import { defineConfig } from 'vitest/config';

// Unit tests over pure domain logic (hashing, diff, conflicts, free rooms).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
