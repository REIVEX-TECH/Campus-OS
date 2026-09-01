import { expect, test } from '@playwright/test';

// Nested-host resolution. playwright.config.ts sets TENANT_BASE_DOMAIN and
// PLATFORM_HOST to localhost:<port> and a DISTINCT legacy APP_DOMAIN, so:
//  - `Host: lgu.localhost:<port>`  is a tenant subdomain of the tenant base
//  - `Host: lgu.<legacy>`          is the old flat host that 308s forward
// We simulate the host with a header on a request fixture (no DNS needed).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const NESTED = `lgu.localhost:${PORT}`;
const LEGACY = 'lgu.legacy.test';

test('a tenant resolves on its nested {slug}.TENANT_BASE_DOMAIN host', async ({ request }) => {
  const res = await request.get('/timetable', { headers: { Host: NESTED } });
  expect(res.status()).toBe(200);
  // The tenant page rendered (the eyebrow shows the university display name).
  expect(await res.text()).toContain('Lahore Garrison University');
});

test('the legacy {slug}.APP_DOMAIN host 308s to the nested host', async ({ request }) => {
  const res = await request.get('/timetable', {
    headers: { Host: LEGACY },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(308);
  const location = res.headers()['location'] ?? '';
  expect(location).toContain('lgu.localhost'); // moved to the new base host
  expect(location).toContain('/timetable'); // path preserved
  expect(location).not.toContain('legacy.test'); // left the legacy host
});
