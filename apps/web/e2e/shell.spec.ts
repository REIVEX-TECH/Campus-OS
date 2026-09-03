import { expect, test } from '@playwright/test';

test('the tenant app shell shows the module sidebar with the active page marked', async ({
  page,
}) => {
  await page.goto('/u/lgu/timetable');

  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav).toBeVisible();

  // Live modules are links; the current page is marked active.
  await expect(nav.getByRole('link', { name: 'Timetable' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Free rooms' })).toBeVisible();
  // Search is not here: it lives in the top bar, on every page.
  await expect(nav.getByRole('link', { name: 'Search' })).toHaveCount(0);

  // Coming-soon modules are present as non-link rows (no href to click).
  await expect(nav.getByText('Marketplace')).toBeVisible();
  await expect(nav.locator('a', { hasText: 'Marketplace' })).toHaveCount(0);

  // The desktop collapse toggle exists (icons-only reclaim), a labelled toggle.
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapse).toBeVisible();
  await expect(collapse).toHaveAttribute('aria-pressed', 'false');
});

test('the mobile drawer is a focus-contained modal that returns focus on close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/u/lgu/timetable');

  const hamburger = page.getByRole('button', { name: 'Open menu' });
  await hamburger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Focus moves into the drawer (the dialog receives it), and the rest of the
  // shell is inert.
  await expect(dialog).toBeFocused();
  await expect(page.locator('main#main')).toHaveAttribute('inert', '');

  // Escape closes it and returns focus to the hamburger.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('main#main')).not.toHaveAttribute('inert', '');
  await expect(hamburger).toBeFocused();
});
