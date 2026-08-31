import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Preserve the ambient env (DATABASE_URL etc.) and align APP_DOMAIN to the e2e
// host so a `Host: lgu.localhost:<port>` header is treated as a real subdomain
// (used by admin-subdomain.spec.ts). `Host: localhost:<port>` stays path-based,
// so the /u/lgu specs keep working.
const webServerEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) webServerEnv[key] = value;
}
webServerEnv.APP_DOMAIN = `localhost:${PORT}`;

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
        env: webServerEnv,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
