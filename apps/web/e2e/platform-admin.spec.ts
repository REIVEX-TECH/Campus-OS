import { expect, test } from '@playwright/test';

/**
 * Platform administration lives on the platform host and only for a platform
 * admin. To everyone else its pages and mutations are 404, so nothing about
 * who administers the platform leaks; the bare /admin placeholder and the sign
 * in page stay reachable, because they are how an admin gets in.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const PLATFORM = `localhost:${PORT}`;
const fromOurPage = () => ({
  origin: String(test.info().project.use.baseURL),
  Host: PLATFORM,
});

test('platform admin pages and mutations do not exist without the platform role', async ({
  request,
}) => {
  for (const path of ['/admin/tenants/new', '/admin/tenants/lgu']) {
    const res = await request.get(path, { headers: { Host: PLATFORM } });
    expect(res.status(), path).toBe(404);
  }
  const create = await request.post('/api/platform/tenants', {
    headers: fromOurPage(),
    data: { config: { slug: 'zzz', displayName: 'Nope' } },
  });
  expect(create.status()).toBe(404);
  const update = await request.post('/api/platform/tenants/lgu', {
    headers: fromOurPage(),
    data: { config: { slug: 'lgu', displayName: 'Nope' } },
  });
  expect(update.status()).toBe(404);
});

test('the platform sign in page exists on the platform host', async ({ request }) => {
  const res = await request.get('/signin', { headers: { Host: PLATFORM } });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Sign in');
});
