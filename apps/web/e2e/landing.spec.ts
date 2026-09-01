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
