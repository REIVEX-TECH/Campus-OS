import { expect, test } from '@playwright/test';

test('free rooms page: control renders and lists rooms free in a window', async ({ page }) => {
  // A pre-class window so rooms are free regardless of the fixture's schedule.
  await page.goto('/u/lgu/free-rooms?day=1&from=06:00&to=06:30');

  await expect(page.getByRole('heading', { name: 'Free rooms' })).toBeVisible();
  await expect(page.locator('#fr-day')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free now' })).toBeVisible();

  // Each free room links to its own schedule page.
  await expect(page.locator('a[href^="/u/lgu/rooms/"]').first()).toBeVisible();
});
