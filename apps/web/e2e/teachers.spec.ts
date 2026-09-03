import { expect, test } from '@playwright/test';

// The card carries `data-name` because the generated avatar renders its initials
// as SVG text, which would otherwise lead the card's text content.
const cardLinks = 'main li a[data-name]';

test('the teacher directory lists teachers and filters as you type', async ({ page }) => {
  await page.goto('/u/lgu/teachers');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Teachers');

  const cards = page.locator(cardLinks);
  const total = await cards.count();
  expect(total).toBeGreaterThan(0);

  const name = (await cards.first().getAttribute('data-name'))!;
  await page.getByRole('searchbox', { name: 'Search teachers', exact: true }).fill(name);
  await expect(page.locator(`${cardLinks}[data-name="${name}"]`)).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(total);

  // A query that matches nothing shows the empty note, not a stale grid.
  await page.getByRole('searchbox', { name: 'Search teachers', exact: true }).fill('zzzzzzzz');
  await expect(page.getByText(/No teachers match/)).toBeVisible();
  expect(await cards.count()).toBe(0);
});

test('a teacher profile shows a generated avatar, stats and free slots', async ({ page }) => {
  await page.goto('/u/lgu/teachers');
  const first = page.locator(cardLinks).first();
  const name = (await first.getAttribute('data-name'))!;
  await first.click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  // The avatar is generated on the server and served from the cached avatar
  // route, so it is an <img> at that path rather than an inline drawing.
  await expect(page.locator('header img[src^="/api/avatar/person/"]')).toBeAttached();
  // Figures and the free-slot card are both derived from the same class list.
  await expect(page.getByText('Classes a week')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free slots' })).toBeVisible();
});

test('a teacher profile fits a phone with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/u/lgu/teachers');
  await page.locator('main li a[data-name]').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
  expect(overflow).toBe(0);
});
