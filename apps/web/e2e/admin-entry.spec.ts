import { expect, test } from '@playwright/test';

// BUG 1: the platform landing card must link to the tenant canonically and must
//        NEVER double the slug (lgu.lgu.*), whatever host the landing is served
//        on. The link is built from TENANT_BASE_DOMAIN, not the request host, so
//        it is deterministic. In e2e the base is local, so the card is the
//        /u/{slug} path form; the production subdomain form and non-doubling are
//        covered exhaustively by the tenant-routing unit tests.
// BUG 2: bare /admin must be a valid entry point, not a 404.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const PLATFORM = `localhost:${PORT}`;
const TENANT = `lgu.localhost:${PORT}`;

test('landing card links to the tenant without doubling the slug, whatever host serves it', async ({
  request,
}) => {
  // Served on the platform host and on an unrelated non-local host: the card is
  // the same deterministic tenant link either way, never the doubled host and
  // never the legacy host.
  for (const host of [PLATFORM, 'campus.example.edu']) {
    const res = await request.get('/', { headers: { Host: host } });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('/u/lgu'); // fail-safe path form (local base)
    expect(html).not.toContain('lgu.lgu'); // never the doubled host (the bug)
    expect(html).not.toContain('reivex.io'); // never the legacy host
  }
});

test('bare /admin on a tenant host sends a signed out visitor to sign in (not a 404)', async ({
  request,
}) => {
  // Admin is a role on an account, so the way in is the ordinary sign in. The
  // redirect reveals nothing: everyone signed out gets it.
  const res = await request.get('/admin', { headers: { Host: TENANT }, maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  const location = res.headers()['location'] ?? '';
  expect(location).toContain('/signin');
  expect(location).not.toContain('/admin/login');
});

test('bare /admin on the platform host serves a placeholder (not a 404)', async ({ request }) => {
  const res = await request.get('/admin', { headers: { Host: PLATFORM } });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Platform administration');
});

test('the platform login is reachable at /login and /signin on the platform host', async ({
  request,
}) => {
  // Both names serve the same platform sign in (the door to platform admin).
  for (const path of ['/login', '/signin']) {
    const res = await request.get(path, { headers: { Host: PLATFORM } });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Sign in to CampusOS');
  }
});
