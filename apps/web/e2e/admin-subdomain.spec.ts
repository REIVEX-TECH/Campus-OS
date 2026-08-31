import { expect, test } from '@playwright/test';

// Reproduces the production bug: on a real tenant subdomain, links/form actions
// must be root-relative. The admin login POST at the CLEAN path must resolve
// (previously it hardcoded /u/lgu/... and 404'd via a double rewrite), and a
// stray /u/lgu/* path must redirect to the canonical clean URL.
//
// We simulate the subdomain with a Host header; playwright.config.ts sets
// APP_DOMAIN=localhost:<port> so `lgu.localhost:<port>` is a real subdomain.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const SUBDOMAIN = `lgu.localhost:${PORT}`;

test('subdomain: admin login POST resolves at the clean path (no double /u/lgu 404)', async ({
  request,
}) => {
  const res = await request.post('/admin/login/submit', {
    headers: { Host: SUBDOMAIN },
    form: { secret: 'wrong' },
    maxRedirects: 0,
  });
  // The route resolved: a 3xx redirect back to login (or rooms), never a 404.
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
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
