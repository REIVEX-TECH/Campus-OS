import { expect, test } from '@playwright/test';

// Cards carry `data-name` because the generated avatar renders its mark as SVG
// text, which would otherwise lead the card's text content.
const cardLinks = 'main li a[data-name]';

test('the room directory lists rooms and filters as you type', async ({ page }) => {
  await page.goto('/u/lgu/rooms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rooms');

  const cards = page.locator(cardLinks);
  const total = await cards.count();
  expect(total).toBeGreaterThan(0);

  const name = (await cards.first().getAttribute('data-name'))!;
  await page.getByRole('searchbox', { name: 'Search rooms' }).fill(name);
  await expect(page.locator(`${cardLinks}[data-name="${name}"]`)).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search rooms' }).fill('zzzzzzzz');
  await expect(page.getByText(/No rooms match/)).toBeVisible();
  expect(await cards.count()).toBe(0);
});

test('a room profile shows how booked it is and when it is free', async ({ page }) => {
  await page.goto('/u/lgu/rooms');
  const first = page.locator(cardLinks).first();
  const name = (await first.getAttribute('data-name'))!;
  await first.click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  await expect(page.locator('header svg').first()).toBeAttached();
  // Utilisation is measured against the shared teaching window, so it is a
  // percentage rather than a raw count.
  await expect(page.getByText('Booked', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free slots' })).toBeVisible();
});
