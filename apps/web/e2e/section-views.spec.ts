import { expect, type Page, test } from '@playwright/test';

/**
 * Find the first section that renders a grid, returning its id. Reads the program
 * ids from the searchable combobox and the section ids from the native select,
 * then drives the cascade by navigating URLs directly (deterministic, no click
 * races). The picker state lives in ?term&program&section.
 */
async function firstSectionId(page: Page): Promise<string> {
  await page.goto('/u/lgu/timetable');
  await page.locator('#pick-program').click(); // semester defaults to the first term
  const programs = (
    await page
      .getByRole('option')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))
  ).filter((v): v is string => Boolean(v));

  for (const pid of programs) {
    await page.goto(`/u/lgu/timetable?program=${pid}`);
    const sections = await page
      .locator('#pick-section option:not([disabled])')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    for (const sid of sections) {
      await page.goto(`/u/lgu/timetable?program=${pid}&section=${sid}`);
      // A populated section renders class blocks (grid) or dots (list); count is
      // DOM-attached, unaffected by the visibility-probe timing.
      if ((await page.locator('.evt, .evt-dot').count()) > 0) return sid;
    }
  }
  throw new Error('no populated section found in the fixture');
}

test('section view switcher toggles four views and drops the per-class Unverified badge', async ({
  page,
}) => {
  const sectionId = await firstSectionId(page);
  await page.goto(`/u/lgu/sections/${sectionId}`);

  // De-noised: the per-class "Unverified" badge is gone; a single header note remains.
  await expect(page.getByText('Unverified')).toHaveCount(0);

  // The switcher offers exactly four views (default is responsive, so it is not
  // asserted here). Each activates on click (instant toggle); the day-scoped
  // views (Days, Timeline) reveal a day tablist, Grid does not.
  const group = page.getByRole('group', { name: 'View' });
  await expect(group.getByRole('button')).toHaveCount(4);

  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('tablist')).toHaveCount(0);

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Days', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Days', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('tablist')).toBeVisible();

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('tablist')).toBeVisible();
});
