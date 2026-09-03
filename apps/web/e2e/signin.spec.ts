import { expect, test } from '@playwright/test';

// CI runs without Firebase configured, which is the important case to pin: sign
// in must degrade to a clear message rather than breaking, and nothing about the
// public site may depend on an identity provider existing.
test('sign in reports plainly when the provider is not configured', async ({ page }) => {
  await page.goto('/u/lgu/signin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page.getByText(/not set up on this deployment/)).toBeVisible();
  // The rest of the page explains itself without a provider: the example
  // identity, the three facts, and a real way back.
  await expect(page.getByText('Amber_Cascade_4821')).toBeVisible();
  await expect(page.locator('img[src^="/api/avatar/person/signin-preview"]')).toBeAttached();
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Back to the timetable' })).toHaveAttribute(
    'href',
    '/u/lgu/timetable',
  );
});

test('the account row in the sidebar offers sign in when signed out', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  // The account row sits in the sidebar foot, below the module nav.
  const account = page.locator('.sidebar-foot a[href="/u/lgu/signin"]');
  await expect(account).toHaveCount(1);
  await expect(account).toContainText('Sign in');
});

test('the sidebar sign in row is a real link when no provider is configured', async ({ page }) => {
  // With a provider the row signs you in on the spot. Without one it must still
  // take you somewhere that explains why it cannot, rather than doing nothing.
  await page.goto('/u/lgu/timetable');
  await page.locator('.sidebar-foot a[href="/u/lgu/signin"]').click();
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
});

test('the public site works with no session at all', async ({ page }) => {
  // The whole point of per-module auth: signing in is a gate on some actions,
  // never on reading a timetable.
  await page.context().clearCookies();
  await page.goto('/u/lgu/timetable');
  await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible();
  await page.goto('/u/lgu/teachers');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Teachers');
});

test('signing out is accepted even with no session', async ({ request }) => {
  const response = await request.delete('/api/auth/session');
  expect(response.status()).toBe(200);
});

test('the session endpoint refuses a token it cannot verify', async ({ request }) => {
  const response = await request.post('/api/auth/session', {
    data: { idToken: 'not-a-real-token' },
  });
  // 503 when the provider is unconfigured (CI), 401 when it is configured and
  // the token is bad. Either way it must never mint a session.
  expect([401, 503]).toContain(response.status());
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('the account page is only for people who are signed in', async ({ page }) => {
  // Signed out it sends you where you can do something about that, rather than
  // rendering an empty shell of somebody's profile.
  await page.goto('/u/lgu/account');
  await expect(page).toHaveURL(/\/u\/lgu\/signin$/);
});

test('changing a handle requires a session', async ({ request }) => {
  const response = await request.post('/api/account/handle', { data: { handle: 'Quiet_Otter_9' } });
  expect(response.status()).toBe(401);
});

test('re rolling an avatar requires a session', async ({ request }) => {
  const response = await request.post('/api/account/avatar');
  expect(response.status()).toBe(401);
});

test('recording a recent view requires a session', async ({ request }) => {
  const response = await request.post('/api/account/recents', {
    data: { tenant: 'lgu', kind: 'section', key: 'x', label: 'x', href: '/u/lgu/timetable' },
  });
  expect(response.status()).toBe(401);
});

test('the admin verification page does not exist for anyone signed out', async ({ page }) => {
  // 404, not 403: the page's existence must say nothing about who holds the role.
  const response = await page.goto('/u/lgu/admin/verification');
  expect(response?.status()).toBe(404);
});

test('an admin decision is not found without the role', async ({ request }) => {
  const response = await request.post('/api/admin/verification', {
    data: {
      tenant: 'lgu',
      requestId: '00000000-0000-0000-0000-000000000000',
      decision: 'approve',
    },
  });
  expect(response.status()).toBe(404);
});

test('asking to be verified requires a session', async ({ request }) => {
  const response = await request.post('/api/account/verification', {
    data: { tenant: 'lgu', fullName: 'Someone', rollNumber: '042' },
  });
  expect(response.status()).toBe(401);
});
