import { expect, test } from '@playwright/test';

// The top bar is the app's chrome: it is on every tenant page, it carries the
// brand, the search and the account, and the sidebar under it is navigation
// alone. This pins that it actually renders, in that order, rather than merely
// existing as a component.

test('the top bar renders on every tenant page, brand left, search centre, account right', async ({
  page,
}) => {
  for (const path of ['/u/lgu/timetable', '/u/lgu/teachers', '/u/lgu/rooms', '/u/lgu/search']) {
    await page.goto(path);
    const bar = page.locator('#app-topbar');
    await expect(bar, path).toBeVisible();
  }

  const bar = page.locator('#app-topbar');
  // Sticky, so it is still there after scrolling down the page.
  await page.mouse.wheel(0, 1200);
  await expect(bar).toBeInViewport();

  const brand = bar.getByRole('link', { name: 'Lahore Garrison University' });
  const search = bar.getByRole('searchbox');
  const account = bar.getByRole('link', { name: /Sign in/ });
  for (const part of [brand, search, account]) await expect(part).toBeVisible();

  // Left to right, in that order, on one row.
  const [b, s, a] = await Promise.all([brand, search, account].map((l) => l.boundingBox()));
  expect(b!.x).toBeLessThan(s!.x);
  expect(s!.x).toBeLessThan(a!.x);
});

test('the top bar search runs the real search', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  await page.locator('#app-topbar').getByRole('searchbox').fill('akhtar');
  await page.locator('#app-topbar').getByRole('searchbox').press('Enter');

  await page.waitForURL(/\/u\/lgu\/search\?q=akhtar$/);
  await expect(page.locator('a[href^="/u/lgu/teachers/"]').first()).toBeVisible();
  // One search input in the app, and it is the one in the bar.
  await expect(page.locator('main input[type="search"]')).toHaveCount(0);
});

test('the brand and the account are not written twice', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  // The sidebar is navigation alone now: the name and the account live above it.
  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar.getByRole('link', { name: 'Lahore Garrison University' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: /Sign in/ })).toHaveCount(0);
  await expect(sidebar.getByRole('navigation')).toBeVisible();
});

test('on a phone the bar collapses and the sidebar is a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/u/lgu/timetable');
  const bar = page.locator('#app-topbar');

  // Search is an icon until it is asked for, so the bar fits.
  await expect(bar.getByRole('searchbox')).toBeHidden();
  await bar.getByRole('button', { name: 'Search' }).click();
  await expect(bar.getByRole('searchbox')).toBeFocused();
  await bar.getByRole('button', { name: 'Close search' }).click();

  // The hamburger opens the drawer, which is a modal below the bar.
  await bar.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Free rooms' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // No horizontal scroll at any point.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
