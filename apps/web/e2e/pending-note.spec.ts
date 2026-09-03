import { expect, test, type Page } from '@playwright/test';

/**
 * Imported classes that are still pending review get ONE quiet note above the
 * schedule, on every page that shows one, never a badge on every row. The
 * section page had this treatment already; teacher and room pages now match.
 */

const NOTE = 'Some classes are imported automatically and are pending review.';

async function ready(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).not.toHaveText(/^\s*Loading\s*$/, { timeout: 15_000 });
}

test('a teacher schedule carries one pending note and no per-row badges', async ({ page }) => {
  // Rabia Akhtar's fixture classes are pending review.
  await page.goto('/u/lgu/search?q=akhtar');
  await page.locator('main a[href^="/u/lgu/teachers/"]').first().click();
  await page.waitForURL(/\/u\/lgu\/teachers\/[^/]+$/);
  await ready(page);

  // The schedule region: the note appears once, the per-row badge never.
  const schedule = page
    .locator('main')
    .getByRole('region', { name: /timetable/i })
    .first();
  const scope = (await schedule.count()) ? schedule : page.locator('main');
  await expect(scope.getByText(NOTE)).toHaveCount(1);
  // Rows are list items; none of them carries the badge any more.
  await expect(page.locator('main li').getByText('Unverified', { exact: true })).toHaveCount(0);
});

test('a room schedule carries one pending note and no per-row badges', async ({ page }) => {
  await page.goto('/u/lgu/rooms');
  await page.locator('main a[href^="/u/lgu/rooms/"]').first().click();
  await page.waitForURL(/\/u\/lgu\/rooms\/[^/]+$/);
  await ready(page);
  await expect(page.locator('main').getByText(NOTE)).toHaveCount(1);
  await expect(page.locator('main li').getByText('Unverified', { exact: true })).toHaveCount(0);
});
