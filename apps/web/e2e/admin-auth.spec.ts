import { expect, test } from '@playwright/test';

/** What a browser always sends with a POST from one of our pages. */
const fromOurPage = () => ({ origin: String(test.info().project.use.baseURL) });

// Admin is a role on an account, never a secret. Without that role there is no
// admin area to find: pages and mutations alike are 404, so nothing about who
// holds the role leaks. This pins both halves, for every admin surface.
test('the admin area does not exist without a permission that opens it', async ({
  page,
  request,
}) => {
  for (const path of [
    '/u/lgu/admin/rooms',
    '/u/lgu/admin/analytics',
    '/u/lgu/admin/verification',
    '/u/lgu/admin/members',
    '/u/lgu/admin/roles',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  // The mutations themselves, not just the pages in front of them.
  const rename = await request.post('/u/lgu/admin/rooms/rename', {
    headers: fromOurPage(),
    form: { roomId: '00000000-0000-0000-0000-000000000000', name: 'Room 25 NB' },
  });
  expect(rename.status()).toBe(404);
  const decide = await request.post('/api/admin/verification', {
    headers: fromOurPage(),
    data: {
      tenant: 'lgu',
      requestId: '00000000-0000-0000-0000-000000000000',
      decision: 'approve',
    },
  });
  expect(decide.status()).toBe(404);
  const verify = await request.post('/api/admin/members/verify', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', handle: 'Quiet_Otter_1234' },
  });
  expect(verify.status()).toBe(404);
  const grant = await request.post('/api/admin/roles', {
    headers: fromOurPage(),
    data: {
      tenant: 'lgu',
      userId: '00000000-0000-0000-0000-000000000000',
      roleKey: 'tenant_admin',
      action: 'grant',
    },
  });
  expect(grant.status()).toBe(404);
  const define = await request.post('/api/admin/roles/define', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', name: 'Moderator', permissions: ['moderate'] },
  });
  expect(define.status()).toBe(404);
  const suspend = await request.post('/api/admin/members/status', {
    headers: fromOurPage(),
    data: { tenant: 'lgu', userId: '00000000-0000-0000-0000-000000000000', status: 'suspended' },
  });
  expect(suspend.status()).toBe(404);
});

test('the shared secret login is gone', async ({ request }) => {
  // No page to type a secret into, and nothing to post one to.
  expect((await request.get('/u/lgu/admin/login')).status()).toBe(404);
  const submit = await request.post('/u/lgu/admin/login/submit', {
    headers: fromOurPage(),
    form: { secret: 'anything' },
  });
  expect(submit.status()).toBe(404);
  expect((await request.post('/u/lgu/admin/logout', { headers: fromOurPage() })).status()).toBe(
    404,
  );
});

test('the standing routes refuse a stranger', async ({ request }) => {
  const origin = String(test.info().project.use.baseURL);
  const standing = await request.post('/api/admin/members/status', {
    headers: { origin },
    data: {
      tenant: 'lgu',
      userId: '00000000-0000-0000-0000-000000000000',
      status: 'restricted',
      reason: 'because',
    },
  });
  expect(standing.status()).toBe(404);
  const appeal = await request.post('/api/standing/appeal', {
    headers: { origin },
    data: { tenant: 'lgu', note: 'let me back in' },
  });
  expect(appeal.status()).toBe(401);
});
