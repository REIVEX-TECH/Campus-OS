import { expect, test } from '@playwright/test';

// The print stylesheet drops the interactive chrome so a printed timetable is
// just the schedule. Playwright can emulate the print medium, so we can assert
// the @media print rules actually apply.
test('print media hides the app header/nav but keeps the page heading', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  const banner = page.getByRole('banner'); // the app-shell header (nav + toggle)
  const heading = page.getByRole('heading', { level: 1, name: 'Timetable' });
  await expect(banner).toBeVisible();
  await expect(heading).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await expect(banner).toBeHidden(); // chrome is dropped for print
  await expect(heading).toBeVisible(); // the schedule's own heading still prints

  await page.emulateMedia({ media: 'screen' });
  await expect(banner).toBeVisible();
});
