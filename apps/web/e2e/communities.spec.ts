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

test('the comment routes refuse a stranger', async ({ request }) => {
  const create = await request.post(
    '/api/communities/posts/00000000-0000-0000-0000-000000000000/comments',
    { headers: fromOurPage(), data: { tenant: 'lgu', parentId: null, body: 'hi' } },
  );
  expect(create.status()).toBe(401);
  const act = await request.post('/api/communities/comments/00000000-0000-0000-0000-000000000000', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', action: 'vote', value: 1 },
  });
  expect(act.status()).toBe(401);
});

test('the feeds and the directory are pages, and ask for a sign in to read', async ({ page }) => {
  const sorted = await page.goto('/u/lgu/c?feed=all&sort=top&t=week');
  expect(sorted?.status()).toBe(200);
  await expect(page.getByText('Sign in to read and join communities.')).toBeVisible();
  const browse = await page.goto('/u/lgu/c/browse');
  expect(browse?.status()).toBe(200);
  await expect(page.getByText('Sign in to read and join communities.')).toBeVisible();
});

test('the moderation surfaces are not there for a stranger', async ({ page, request }) => {
  expect((await page.goto('/u/lgu/c/cs-freshers/mod'))?.status()).toBe(404);
  expect((await page.goto('/u/lgu/admin/communities'))?.status()).toBe(404);
  await page.goto('/u/lgu/blocked');
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);
  const mod = await request.post('/api/communities/00000000-0000-0000-0000-000000000000/mod', {
    headers: fromOurPage(),
    data: {
      tenant: 'lgu',
      action: 'remove',
      itemType: 'post',
      itemId: '00000000-0000-0000-0000-000000000000',
      reason: 'because',
    },
  });
  expect(mod.status()).toBe(401);
  const block = await request.post('/api/communities/blocks', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', userId: '00000000-0000-0000-0000-000000000000', on: true },
  });
  expect(block.status()).toBe(401);
});

test('the automod rules route refuses a stranger', async ({ request }) => {
  const response = await request.post(
    '/api/communities/00000000-0000-0000-0000-000000000000/automod',
    {
      headers: fromOurPage(),
      data: { tenant: 'lgu', rules: [{ kind: 'keyword', pattern: 'nope', action: 'queue' }] },
    },
  );
  expect(response.status()).toBe(401);
});

test('the poll vote action refuses a stranger', async ({ request }) => {
  const response = await request.post(
    '/api/communities/posts/00000000-0000-0000-0000-000000000000',
    {
      headers: fromOurPage(),
      data: { tenant: 'lgu', action: 'pollVote', optionId: '00000000-0000-0000-0000-000000000000' },
    },
  );
  expect(response.status()).toBe(401);
});

test('the inbox asks a stranger to sign in, and the mark read route refuses them', async ({
  page,
  request,
}) => {
  await page.goto('/u/lgu/notifications');
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);
  const response = await request.post('/api/communities/notifications', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', action: 'read', ids: 'all' },
  });
  expect(response.status()).toBe(401);
});

test('search reaches communities and the directory takes a query', async ({ page }) => {
  expect((await page.goto('/u/lgu/search?q=freshers'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
  expect((await page.goto('/u/lgu/c/browse?q=cs'))?.status()).toBe(200);
});

test('the flairs route and the crosspost action refuse a stranger', async ({ request }) => {
  const flairs = await request.post(
    '/api/communities/00000000-0000-0000-0000-000000000000/flairs',
    {
      headers: fromOurPage(),
      data: { tenant: 'lgu', flairs: [{ name: 'Q', color: '#000000' }] },
    },
  );
  expect(flairs.status()).toBe(401);
  const cross = await request.post('/api/communities/posts/00000000-0000-0000-0000-000000000000', {
    headers: fromOurPage(),
    data: {
      tenant: 'lgu',
      action: 'crosspost',
      communityId: '00000000-0000-0000-0000-000000000000',
    },
  });
  expect(cross.status()).toBe(401);
});

test('an unknown profile is not found, and the hidden list asks for a sign in', async ({
  page,
}) => {
  expect((await page.goto('/u/lgu/people/No_Such_Person_0000'))?.status()).toBe(404);
  await page.goto('/u/lgu/hidden');
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);
});
