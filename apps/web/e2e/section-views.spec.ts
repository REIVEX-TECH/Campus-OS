import { expect, type Locator, type Page, test } from '@playwright/test';

// The real (non-placeholder) option values of a native <select>.
async function realOptions(select: Locator): Promise<string[]> {
  return select
    .locator('option:not([disabled])')
    .evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
}

/** Drive the cascade to the first section that renders a grid, returning its id. */
async function firstSectionId(page: Page): Promise<string> {
  await page.goto('/u/lgu/timetable');
  const program = page.locator('#pick-program');
  await expect(program).toBeVisible();
  for (const pv of await realOptions(program)) {
    await program.selectOption(pv);
    await page.waitForURL((u) => u.searchParams.get('program') === pv);
    const section = page.locator('#pick-section');
    await expect(section).toBeVisible();
    for (const sv of await realOptions(section)) {
      await section.selectOption(sv);
      await page.waitForURL((u) => u.searchParams.get('section') === sv);
      if (await page.locator('section h3').first().isVisible()) return sv;
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

  // The switcher offers exactly four views; List is the default.
  const group = page.getByRole('group', { name: 'View' });
  await expect(group.getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Instant toggle: each view activates on click. The day-scoped views (Days,
  // Timeline) reveal a day tablist; Grid does not.
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('tablist')).toHaveCount(0);

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
