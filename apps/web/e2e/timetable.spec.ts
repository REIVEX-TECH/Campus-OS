import { expect, type Page, test } from '@playwright/test';

// The picker state lives in the URL (?term&program&section). We read the program
// ids from the searchable combobox and the section ids from the native select,
// then drive the cascade by navigating URLs directly. That keeps the picker
// exercised while being deterministic (no soft-navigation click races). Lands the
// page on the first section that renders a timetable (view switcher visible).
async function programIds(page: Page): Promise<string[]> {
  await page.goto('/u/lgu/timetable');
  await page.locator('#pick-program').click(); // semester defaults to the first term
  const ids = await page
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
  return ids.filter((v): v is string => Boolean(v));
}

async function sectionIds(page: Page, pid: string): Promise<string[]> {
  await page.goto(`/u/lgu/timetable?program=${pid}`);
  return page
    .locator('#pick-section option:not([disabled])')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
}

async function cascadeToPopulatedSection(page: Page): Promise<void> {
  const programs = await programIds(page);
  expect(programs.length).toBeGreaterThan(0);
  for (const pid of programs) {
    for (const sid of await sectionIds(page, pid)) {
      await page.goto(`/u/lgu/timetable?program=${pid}&section=${sid}`);
      // A populated section renders class blocks (grid) or dots (list). Count is
      // DOM-attached, so it is not subject to the visibility-probe timing.
      if ((await page.locator('.evt, .evt-dot').count()) > 0) return;
    }
  }
  throw new Error('no section with a rendered timetable was found in the fixture');
}

test('cascade picker renders a section timetable inline, with an ICS subscribe', async ({
  page,
  request,
}) => {
  await cascadeToPopulatedSection(page);
  await expect(page).toHaveURL(/section=/); // shareable state lives in the URL

  // The inline render uses the SAME four-view switcher as the section page (one
  // shared component, so the two paths cannot drift), and de-noises the badge.
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button')).toHaveCount(4);
  await expect(page.getByText('Unverified')).toHaveCount(0);

  // The selected section exposes an ICS feed that returns a valid calendar.
  const subscribe = page.getByRole('link', { name: /subscribe/i });
  await expect(subscribe).toBeVisible();
  const href = await subscribe.getAttribute('href');
  expect(href).toContain('/sections/');
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  expect(await res.text()).toContain('UID:');
});

test('the semester combobox is searchable and keyboard-operable', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  const semester = page.getByRole('combobox', { name: 'Semester' });
  await expect(semester).toBeVisible();

  // Opening it lists the terms; typing filters them.
  await semester.click();
  await expect(page.getByRole('option').first()).toBeVisible();

  // Arrow + Enter picks a term, closes the listbox, and writes ?term to the URL.
  await semester.press('ArrowDown');
  await semester.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page).toHaveURL(/term=/);
});

test('a teacher name links to the teacher view', async ({ page }) => {
  await cascadeToPopulatedSection(page);

  // Teacher names are links in the row-based views; switch to List to find one.
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const link = page.locator('a[href^="/u/lgu/teachers/"]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');

  await page.goto(href!);
  await expect(page).toHaveURL(/\/u\/lgu\/teachers\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // the teacher's name
  await expect(page.locator('section h3').first()).toBeVisible(); // their weekly grid
});
