import { expect, test } from '@playwright/test';

/**
 * Communities, signed out: the module is live in the nav, reading asks for a
 * sign in (the tenant default), creating needs one, an unknown community is
 * 404 whoever asks, and the mutation routes refuse a stranger.
 */
const fromOurPage = () => ({ origin: String(test.info().project.use.baseURL) });

test('the communities module is live and asks for a sign in to read', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  await expect(page.locator('nav a[href="/u/lgu/c"]').first()).toBeVisible();

  const response = await page.goto('/u/lgu/c');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Communities' })).toBeVisible();
  await expect(page.getByText('Sign in to read and join communities.')).toBeVisible();
});

test('starting a community needs a sign in, and an unknown one is not found', async ({ page }) => {
  await page.goto('/u/lgu/c/new');
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);

  const missing = await page.goto('/u/lgu/c/no-such-community');
  expect(missing?.status()).toBe(404);
});

test('the mutation routes refuse a stranger', async ({ request }) => {
  const create = await request.post('/api/communities', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', name: 'Nope Club' },
  });
  expect(create.status()).toBe(401);
  const join = await request.post(
    '/api/communities/00000000-0000-0000-0000-000000000000/membership',
    {
      headers: fromOurPage(),
      data: { tenant: 'lgu', action: 'join' },
    },
  );
  expect(join.status()).toBe(401);
  // Without our origin nothing is even considered.
  const foreign = await request.post('/api/communities', {
    headers: { origin: 'https://elsewhere.example' },
    data: { tenant: 'lgu', name: 'Nope Club' },
  });
  expect(foreign.status()).toBe(403);
});

test('posting needs a community and a sign in', async ({ page, request }) => {
  expect((await page.goto('/u/lgu/c/no-such-community/submit'))?.status()).toBe(404);
  const act = await request.post('/api/communities/posts/00000000-0000-0000-0000-000000000000', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', action: 'vote', value: 1 },
  });
  expect(act.status()).toBe(401);
});
