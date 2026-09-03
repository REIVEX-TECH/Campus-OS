import { expect, test } from '@playwright/test';

// CI runs without Firebase configured, which is the important case to pin: sign
// in must degrade to a clear message rather than breaking, and nothing about the
// public site may depend on an identity provider existing.
test('sign in reports plainly when the provider is not configured', async ({ page }) => {
  await page.goto('/u/lgu/signin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page.getByText(/not set up on this deployment/)).toBeVisible();
});

test('the account row in the sidebar offers sign in when signed out', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  // The account row sits in the sidebar foot, below the module nav.
  const account = page.locator('.sidebar-foot a[href="/u/lgu/signin"]');
  await expect(account).toHaveCount(1);
  await expect(account).toContainText('Sign in');
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
