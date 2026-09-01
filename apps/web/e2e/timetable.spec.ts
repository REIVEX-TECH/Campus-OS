import { expect, type Locator, type Page, test } from '@playwright/test';

// The real (non-placeholder) option values of a native <select>.
async function realOptions(select: Locator): Promise<string[]> {
  return select
    .locator('option:not([disabled])')
    .evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
}

// Drive the cascade to the first program, then step through its sections until a
// weekly grid renders (a section that has entries). Returns once the grid is up.
async function cascadeToPopulatedSection(page: Page): Promise<void> {
  await page.goto('/u/lgu/timetable');

  const program = page.locator('#pick-program');
  await expect(program).toBeVisible(); // semester defaults to the first term
  const programs = await realOptions(program);
  expect(programs.length).toBeGreaterThan(0);

  for (const pv of programs) {
    await program.selectOption(pv);
    await page.waitForURL((u) => u.searchParams.get('program') === pv);

    const section = page.locator('#pick-section');
    await expect(section).toBeVisible();
    for (const sv of await realOptions(section)) {
      await section.selectOption(sv);
      await page.waitForURL((u) => u.searchParams.get('section') === sv);
      if (await page.locator('section h3').first().isVisible()) return; // a weekday group
    }
  }
  throw new Error('no section with a rendered timetable was found in the fixture');
}

test('cascade picker renders a section timetable inline, with an ICS subscribe', async ({
  page,
  request,
}) => {
  await cascadeToPopulatedSection(page);

  // Inline day-grouped grid with an accessible caption and at least one weekday.
  await expect(page.locator('section h3').first()).toBeVisible();
  await expect(page).toHaveURL(/section=/); // shareable state lives in the URL

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

test('a teacher name in the grid links to the teacher view', async ({ page }) => {
  await page.goto('/u/lgu/timetable');

  const program = page.locator('#pick-program');
  await expect(program).toBeVisible();

  // Find some section grid that shows a teacher, then follow that link.
  let teacherHref: string | null = null;
  for (const pv of await realOptions(program)) {
    await program.selectOption(pv);
    await page.waitForURL((u) => u.searchParams.get('program') === pv);
    const section = page.locator('#pick-section');
    await expect(section).toBeVisible();
    for (const sv of await realOptions(section)) {
      await section.selectOption(sv);
      await page.waitForURL((u) => u.searchParams.get('section') === sv);
      const link = page.locator('a[href^="/u/lgu/teachers/"]').first();
      if (await link.count()) {
        teacherHref = await link.getAttribute('href');
        break;
      }
    }
    if (teacherHref) break;
  }
  expect(teacherHref, 'expected at least one teacher link in a section grid').toBeTruthy();

  await page.goto(teacherHref!);
  await expect(page).toHaveURL(/\/u\/lgu\/teachers\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // the teacher's name
  await expect(page.locator('section h3').first()).toBeVisible(); // their weekly grid
});
