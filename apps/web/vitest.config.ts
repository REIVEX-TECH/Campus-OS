import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright e2e specs live in ./e2e and run separately.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
