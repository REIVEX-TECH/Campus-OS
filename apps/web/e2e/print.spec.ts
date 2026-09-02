import { expect, test } from '@playwright/test';

// The print stylesheet drops the interactive chrome so a printed timetable is
// just the schedule. Playwright can emulate the print medium, so we can assert
// the @media print rules actually apply.
test('print media hides the app nav but keeps the page heading', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  const nav = page.getByRole('navigation', { name: 'Modules' }); // the app-shell sidebar
  const heading = page.getByRole('heading', { level: 1, name: 'Timetable' });
  await expect(nav).toBeVisible();
  // The heading is present and not hidden on screen. (Not asserted with
  // toBeVisible: at initial paint of the nested app-shell + PageShell grids,
  // Playwright's visibility probe intermittently reads a laid-out, ancestor-
  // visible <h1> as hidden until a style recalc; display is the robust check.)
  await expect(heading).toHaveText('Timetable');
  await expect(heading).not.toHaveCSS('display', 'none');

  await page.emulateMedia({ media: 'print' });
  await expect(nav).toBeHidden(); // chrome is dropped for print
  await expect(heading).not.toHaveCSS('display', 'none'); // the heading still prints

  await page.emulateMedia({ media: 'screen' });
  await expect(nav).toBeVisible();
});
