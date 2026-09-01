import { expect, test } from '@playwright/test';

// BUG 1: the platform landing card must link to the tenant as a subdomain of the
//        CURRENT platform host (single hop), never the legacy host.
// BUG 2: bare /admin must be a valid entry point, not a 404.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const PLATFORM = `localhost:${PORT}`;
const TENANT = `lgu.localhost:${PORT}`;

test('landing card links to a subdomain of the live platform host, not the legacy host', async ({
  request,
}) => {
  // A non-local Host makes the landing emit the production subdomain form; the
  // card href must be {slug}.{that host} and must not contain the legacy domain.
  const res = await request.get('/', { headers: { Host: 'campus.example.edu' } });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('https://lgu.campus.example.edu'); // single-hop nested URL
  expect(html).not.toContain('reivex.io'); // never the legacy {slug}.APP_DOMAIN host
});

test('bare /admin on a tenant host redirects to the login (not a 404)', async ({ request }) => {
  const res = await request.get('/admin', { headers: { Host: TENANT }, maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  const location = res.headers()['location'] ?? '';
  expect(location).toContain('/admin/login');
});

test('bare /admin on the platform host serves a placeholder (not a 404)', async ({ request }) => {
  const res = await request.get('/admin', { headers: { Host: PLATFORM } });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Platform administration');
});
