import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Runs `next start`, so build the app first (CI does `pnpm build` before e2e).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'line',
  use: { baseURL },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `next start -p ${PORT}`,
        url: `${baseURL}/u/lgu/timetable`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
