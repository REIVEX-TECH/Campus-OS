import { expect, test, type Page } from '@playwright/test';
import { cascadeToPopulatedSection } from './cascade';

/** The first section that renders a grid, by id (drives the shared path-form cascade). */
async function firstSectionId(page: Page): Promise<string> {
  const { section } = await cascadeToPopulatedSection(page);
  return section;
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
