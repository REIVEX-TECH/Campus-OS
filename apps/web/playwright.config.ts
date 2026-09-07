import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Preserve the ambient env (DATABASE_URL etc.) and align the host vars to the
// e2e port so `Host: lgu.localhost:<port>` is treated as a real tenant subdomain
// (admin-subdomain + tenant-host specs). `Host: localhost:<port>` is the bare
// platform base, so it stays path-based and the /u/lgu specs keep working.
// APP_DOMAIN is a DISTINCT legacy root, so `Host: lgu.<legacy>` exercises the
// 308 to `lgu.localhost:<port>` (tenant-host spec).
const webServerEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) webServerEnv[key] = value;
}
webServerEnv.TENANT_BASE_DOMAIN = `localhost:${PORT}`;
webServerEnv.PLATFORM_HOST = `localhost:${PORT}`;
webServerEnv.APP_DOMAIN = 'legacy.test';
// Lost & Found (and marketplace) photo uploads need an object-store directory. The
// LocalFsStore creates it on first write, so a temp dir is enough for the suite.
webServerEnv.MEDIA_DATA_DIR = process.env.MEDIA_DATA_DIR ?? join(tmpdir(), 'campusos-e2e-media');

// Runs `next start`, so build the app first (CI does `pnpm build` before e2e).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
