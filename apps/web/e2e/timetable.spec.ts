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

test('the picker shows all three steps, enabling section only after a program', async ({
  page,
}) => {
  const [pid] = await programIds(page);

  // Fresh load: semester defaults to the first term, so program is ready; the
  // section step is visible but disabled with a hint (progressive enabling).
  await page.goto('/u/lgu/timetable');
  const section = page.locator('#pick-section');
  await expect(section).toBeVisible();
  await expect(section).toBeDisabled();
  await expect(page.getByText('Choose a program first')).toBeVisible();

  // Choosing a program enables the section step and drops the hint.
  await page.goto(`/u/lgu/timetable?program=${pid}`);
  await expect(page.locator('#pick-section')).toBeEnabled();
  await expect(page.getByText('Choose a program first')).toHaveCount(0);
});

test('the results skeleton shows while the next section loads', async ({ page }) => {
  const programs = await programIds(page);
  expect(programs.length).toBeGreaterThan(0);
  const pid = programs[0]!;
  const sids = await sectionIds(page, pid);
  expect(sids.length).toBeGreaterThan(0);
  const sid = sids[0]!;

  await page.goto(`/u/lgu/timetable?program=${pid}`);
  await expect(page.locator('#pick-section')).toBeEnabled();

  // Hold the soft-navigation RSC fetch briefly (fetch the real response, then
  // deliver it after a delay) so the pending skeleton is observable, and the
  // navigation still commits afterwards.
  await page.route('**/u/lgu/timetable**', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await page.locator('#pick-section').selectOption(sid);

  // The results column is marked busy (and shows the skeleton) while the section
  // loads, then clears once the new content arrives. The pending state is driven
  // by the picker's transition, so it is reliable on a soft navigation.
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`section=${sid}`), { timeout: 6000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 6000 });
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
  // Picking runs a soft navigation, so the URL lands only after the server
  // responds; allow for a loaded CI runner rather than the 5s default.
  await expect(page).toHaveURL(/term=/, { timeout: 15_000 });
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
