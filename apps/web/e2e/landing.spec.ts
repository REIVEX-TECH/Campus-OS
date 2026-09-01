import { expect, test } from '@playwright/test';

// The platform landing is served on the platform host (localhost:<port> in the
// e2e config), path `/`. A tenant subdomain would show the tenant instead.
test('the platform landing shows the hero, features, and a university link', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Live timetables', { exact: true })).toBeVisible();

  // The universities section links out to a tenant.
  await expect(page.getByRole('link', { name: /Lahore Garrison University/ })).toBeVisible();

  // The GitHub link is external and safe (new tab, noopener).
  const gh = page.getByRole('link', { name: 'View on GitHub' }).first();
  await expect(gh).toHaveAttribute('rel', /noopener/);
});

test('the app has a branded icon and web manifest', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /icon\.svg/);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect(await manifest.text()).toContain('CampusOS');
});

test('a keyboard user can skip past the header to the content', async ({ page }) => {
  await page.goto('/');
  // The skip link is the first tab stop and targets the main landmark.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main');
  await expect(page.locator('main#main')).toHaveCount(1);
});
