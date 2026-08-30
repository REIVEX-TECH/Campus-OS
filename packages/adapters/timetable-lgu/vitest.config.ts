import { defineConfig } from 'vitest/config';

// All tests run against recorded fixtures — never the live network.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
