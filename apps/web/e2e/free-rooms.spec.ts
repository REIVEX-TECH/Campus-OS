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

test('the free rooms summary count matches the rooms listed', async ({ page }) => {
  await page.goto('/u/lgu/free-rooms?day=1&from=09:30&to=11:00');
  // The summary reads "13 free, Monday 09:30 to 11:00". The intro above it
  // also says "free", so match the count and the comma, not the word alone.
  const summary = await page.locator('main p', { hasText: /^\d+ free,/ }).innerText();
  const count = Number(/^(\d+) free,/.exec(summary)?.[1]);
  expect(Number.isFinite(count)).toBe(true);
  await expect(page.locator('main a[href^="/u/lgu/rooms/"]')).toHaveCount(count);
});
