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
  await expect(page.locator('header img[src^="/api/avatar/place/"]')).toBeAttached();
  // Utilisation is measured against the shared teaching window, so it is a
  // percentage rather than a raw count.
  await expect(page.getByText('Booked', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free slots' })).toBeVisible();
});

test('the avatar route renders a cacheable svg and rejects a bad seed', async ({ request }) => {
  const ok = await request.get('/api/avatar/person/abc-123');
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toContain('image/svg+xml');
  // Deterministic output, so it is safe to cache forever.
  expect(ok.headers()['cache-control']).toContain('immutable');
  expect(await ok.text()).toContain('<svg');

  // Same seed, same picture.
  const again = await request.get('/api/avatar/person/abc-123');
  expect(await again.text()).toBe(await ok.text());

  // A different kind is a different picture.
  const place = await request.get('/api/avatar/place/abc-123');
  expect(await place.text()).not.toBe(await ok.text());

  // Unknown kinds and unsafe seeds are refused rather than rendered.
  expect((await request.get('/api/avatar/wizard/abc-123')).status()).toBe(404);
  expect((await request.get('/api/avatar/person/' + 'x'.repeat(80))).status()).toBe(404);
});
