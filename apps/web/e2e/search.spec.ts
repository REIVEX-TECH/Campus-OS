import { expect, test } from '@playwright/test';

test('search finds courses and teachers and links to their pages', async ({ page }) => {
  // Course match (SSR via ?q); links to the course "where and when" page.
  await page.goto('/u/lgu/search?q=program');
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(page.locator('a[href^="/u/lgu/courses/"]').first()).toBeVisible();

  // Teacher match; links to the teacher's weekly timetable.
  await page.goto('/u/lgu/search?q=akhtar');
  await expect(page.locator('a[href^="/u/lgu/teachers/"]').first()).toBeVisible();
});
