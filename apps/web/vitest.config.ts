import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright e2e specs live in ./e2e and run separately.
// The `@` alias mirrors tsconfig `paths`, so modules (and their own imports)
// resolve the same way under vitest as they do in the Next build.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
