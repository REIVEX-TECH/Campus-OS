import { expect, test } from '@playwright/test';

test('tenant home is a module hub: live modules link out, soon modules open a stub', async ({
  page,
}) => {
  await page.goto('/u/lgu');

  // Live modules link to their real pages (scoped to the hub card grid, since
  // the header nav also links to them).
  const grid = page.getByRole('list').first();
  await expect(grid.locator('a[href="/u/lgu/timetable"]')).toBeVisible();
  await expect(grid.locator('a[href="/u/lgu/free-rooms"]')).toBeVisible();

  // A "soon" module opens a Coming soon stub (pure UI, no feature).
  await page.locator('a[href="/u/lgu/soon/marketplace"]').click();
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toBeVisible();

  // The stub links back to the hub.
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(/\/u\/lgu$/);
});

test('an unknown or live module key has no Coming soon page', async ({ page }) => {
  // "timetable" is a live module, not a soon stub → 404.
  const res = await page.goto('/u/lgu/soon/timetable');
  expect(res?.status()).toBe(404);
});
