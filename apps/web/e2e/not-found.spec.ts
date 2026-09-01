import { expect, test } from '@playwright/test';

test('an unknown tenant renders the 404 page with a link home', async ({ page }) => {
  const res = await page.goto('/u/definitely-not-a-tenant');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to homepage' })).toHaveAttribute('href', '/');
});
