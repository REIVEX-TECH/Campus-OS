import { expect, test } from '@playwright/test';
import { cascadeToPopulatedSection, firstTermId, programIds, sectionIds } from './cascade';

test('cascade picker renders a section timetable inline, with an ICS subscribe', async ({
  page,
  request,
}) => {
  await cascadeToPopulatedSection(page);
  await expect(page).toHaveURL(/\/s\//); // shareable state lives in the URL path

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

test('selecting a section is a soft navigation, not a full page reload', async ({ page }) => {
  const { term, program, section } = await cascadeToPopulatedSection(page);
  // Reset to the program step so the section dropdown is populated but none is chosen.
  await page.goto(`/u/lgu/timetable/t/${term}/p/${program}`);
  await expect(page.locator('#pick-section')).toBeEnabled();

  // Mark the window. A full navigation builds a fresh window and wipes this; a soft
  // navigation keeps it. This is how we assert "no full navigation event fired".
  await page.evaluate(() => {
    (window as unknown as { __kept?: boolean }).__kept = true;
  });

  await page.locator('#pick-section').selectOption(section);

  // The URL moved to the section path...
  await expect(page).toHaveURL(new RegExp(`/t/${term}/p/${program}/s/${section}`), {
    timeout: 6000,
  });
  // ...and the marker survived, so only the schedule pane re-rendered (soft nav). The
  // selectors stayed mounted in the layout.
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
  await expect(page.locator('#pick-section')).toBeVisible();
});

test('the legacy query URL 301s to the path form', async ({ page, request }) => {
  const term = await firstTermId(page);
  const [pid] = await programIds(page, term);
  // A raw request does not follow redirects, so we can assert the 301 and target.
  const res = await request.get(`/u/lgu/timetable?term=${term}&program=${pid}`, {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(301);
  expect(res.headers()['location']).toContain(`/u/lgu/timetable/t/${term}/p/${pid}`);
});

test('the picker shows all three steps, enabling section only after a program', async ({
  page,
}) => {
  const term = await firstTermId(page);
  const [pid] = await programIds(page, term);

  // Fresh load: semester defaults to the first term, so program is ready; the
  // section step is visible but disabled with a hint (progressive enabling).
  await page.goto('/u/lgu/timetable');
  const section = page.locator('#pick-section');
  await expect(section).toBeVisible();
  await expect(section).toBeDisabled();
  await expect(page.getByText('Choose a program first')).toBeVisible();

  // Choosing a program enables the section step and drops the hint.
  await page.goto(`/u/lgu/timetable/t/${term}/p/${pid}`);
  await expect(page.locator('#pick-section')).toBeEnabled();
  await expect(page.getByText('Choose a program first')).toHaveCount(0);
});

test('selecting a section swaps the schedule with no skeleton flash', async ({ page }) => {
  const term = await firstTermId(page);
  const programs = await programIds(page, term);
  expect(programs.length).toBeGreaterThan(0);
  const pid = programs[0]!;
  const sids = await sectionIds(page, term, pid);
  expect(sids.length).toBeGreaterThan(0);
  const sid = sids[0]!;

  await page.goto(`/u/lgu/timetable/t/${term}/p/${pid}`);
  await expect(page.locator('#pick-section')).toBeEnabled();

  // Delay the schedule RSC fetch so any transient loading state would be observable.
  await page.route('**/u/lgu/timetable**', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  await page.locator('#pick-section').selectOption(sid);

  // The previous pane stays until the new schedule arrives: no busy skeleton replaces it
  // (that boundary was removed so selecting never flickers). The URL still moves and the
  // selectors stay mounted (a soft navigation).
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/s/${sid}`), { timeout: 6000 });
  await expect(page.locator('#pick-section')).toBeVisible();
});

test('the semester combobox is searchable and keyboard-operable', async ({ page }) => {
  await page.goto('/u/lgu/timetable');
  const semester = page.getByRole('combobox', { name: 'Semester' });
  await expect(semester).toBeVisible();

  // Opening it lists the terms; typing filters them. Wait for the combobox to be
  // focused before pressing keys: on a cold runner the click can land before the
  // control is hydrated, and keys pressed then go nowhere (the picker never
  // navigates). Focus is the ready signal, so the keyboard drive is not a race.
  await semester.click();
  await expect(semester).toBeFocused();
  await expect(page.getByRole('option').first()).toBeVisible();

  // Arrow + Enter picks a term, closes the listbox, and writes /t/{term} to the URL.
  await semester.press('ArrowDown');
  await semester.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  // Picking runs a soft navigation, so the URL lands only after the server
  // responds; allow for a loaded CI runner rather than the 5s default.
  await expect(page).toHaveURL(/\/timetable\/t\//, { timeout: 15_000 });
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

test('the timetable page remembers what you looked at, even signed out', async ({ page }) => {
  const { section } = await cascadeToPopulatedSection(page);
  // The note is written after hydration, so wait for THIS section's entry: the
  // cascade above may have recorded an earlier section already.
  await page.waitForFunction(
    (sid) =>
      Object.entries(localStorage).some(
        ([k, v]) => k.startsWith('campusos_recents:') && String(v).includes(String(sid)),
      ),
    section,
  );

  // Back on the bare picker, the section you just saw is one tap away.
  await page.goto('/u/lgu/timetable');
  const panel = page.getByRole('region', { name: 'Recently viewed' });
  await expect(panel).toBeVisible();
  // By href, not by position: the cascade above records several sections and
  // they can land in the same millisecond, so "newest first" does not settle
  // their order and the first row is not reliably the one just viewed.
  const recent = panel.locator(`a[href*="/s/${section}"]`);
  // The panel is client rendered from localStorage after hydration, so on a cold
  // runner the first click can land before the Link's router handler is attached
  // and the soft navigation never fires (the URL stays on the bare picker). Retry
  // the click until the URL carries the section, rather than waiting longer on a
  // single click that already raced hydration. Poll the URL, not waitForURL: a
  // soft navigation never fires the 'load' event waitForURL waits for by default.
  await expect(async () => {
    if (new URL(page.url()).pathname.includes(`/s/${section}`)) return;
    await recent.click({ timeout: 2_000 });
    await expect(page).toHaveURL(new RegExp(`/s/${section}`), { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toContain(`/s/${section}`);

  // And it is the reader's to forget.
  await page.goto('/u/lgu/timetable');
  await page
    .getByRole('region', { name: 'Recently viewed' })
    .getByRole('button', { name: 'Clear' })
    .click();
  await expect(page.getByRole('region', { name: 'Recently viewed' })).toHaveCount(0);
});
