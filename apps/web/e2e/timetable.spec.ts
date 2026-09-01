import { expect, type Locator, type Page, test } from '@playwright/test';

// The real (non-placeholder) option values of a native <select>.
async function realOptions(select: Locator): Promise<string[]> {
  return select
    .locator('option:not([disabled])')
    .evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
}

// Drive the cascade to the first section that renders a timetable (a section with
// entries). "Rendered" is detected by the view switcher appearing, which is
// view-independent (the default view is responsive: grid on desktop, list on
// mobile). Returns once the timetable is up.
async function cascadeToPopulatedSection(page: Page): Promise<void> {
  await page.goto('/u/lgu/timetable');

  const program = page.locator('#pick-program');
  await expect(program).toBeVisible(); // semester defaults to the first term
  const programs = await realOptions(program);
  expect(programs.length).toBeGreaterThan(0);

  const switcher = page.getByRole('group', { name: 'View' });
  for (const pv of programs) {
    await program.selectOption(pv);
    await page.waitForURL((u) => u.searchParams.get('program') === pv);

    const section = page.locator('#pick-section');
    await expect(section).toBeVisible();
    for (const sv of await realOptions(section)) {
      await section.selectOption(sv);
      await page.waitForURL((u) => u.searchParams.get('section') === sv);
      if (await switcher.isVisible().catch(() => false)) return;
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
