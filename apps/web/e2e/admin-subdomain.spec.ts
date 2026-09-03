import { expect, test } from '@playwright/test';

// Reproduces the production bug: on a real tenant subdomain, links, form actions
// and redirects must be root-relative. A redirect at the CLEAN path must resolve
// (previously routes hardcoded /u/lgu/... and 404'd via a double rewrite), and a
// stray /u/lgu/* path must redirect to the canonical clean URL.
//
// We simulate the subdomain with a Host header; playwright.config.ts sets
// APP_DOMAIN=localhost:<port> so `lgu.localhost:<port>` is a real subdomain.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const SUBDOMAIN = `lgu.localhost:${PORT}`;

test('subdomain: the admin entry redirects with a RELATIVE Location', async ({ request }) => {
  const res = await request.get('/admin', {
    headers: { Host: SUBDOMAIN },
    maxRedirects: 0,
  });
  // The route resolved: a 3xx to sign in, never a 404.
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  // The Location must be root-relative, so the browser stays on the public
  // origin. Behind a proxy an absolute Location would point at the upstream
  // (localhost:PORT) and fail with ERR_CONNECTION_REFUSED.
  const location = res.headers()['location'] ?? '';
  expect(location.startsWith('/')).toBe(true);
  expect(location).not.toMatch(/^https?:\/\//);
  expect(location).not.toContain('localhost');
  expect(location).not.toContain('/u/lgu');
});

test('subdomain: a duplicate /u/lgu path redirects to the canonical clean URL', async ({
  request,
}) => {
  const res = await request.get('/u/lgu/timetable', {
    headers: { Host: SUBDOMAIN },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(308);
  const location = res.headers()['location'] ?? '';
  expect(location).toContain('/timetable');
  expect(location).not.toContain('/u/lgu');
});
