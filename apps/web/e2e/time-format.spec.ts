import { expect, test, type Page } from '@playwright/test';

/**
 * LGU shows times as "9:30 AM", never "09:30". Storage is unchanged; this pins
 * the presentation on every page that prints a time. The native time inputs are
 * excluded: the browser renders those per its own locale and their value is the
 * wire format by design.
 *
 * The text is read as textContent, which runs adjacent elements together
 * ("Timeline8 AM9 AM10 AM", "11:30 AM1:00 PM"), so the positive patterns claim
 * no word boundaries at all: a boundary before the hour fails after a letter
 * and one after AM fails before a digit. The negative pattern is the guard that
 * matters, and it excludes any clock time immediately followed by AM or PM.
 */

// A 24 hour clock time that is NOT the hour part of a 12 hour one: "13:00" and
// "09:30" match, "11:00 AM" does not.
const TWENTY_FOUR_HOUR = new RegExp('\\b([01]\\d|2[0-3]):[0-5]\\d\\b(?! ?(?:AM|PM))');
const TWELVE_HOUR = new RegExp('(?:1[0-2]|[1-9]):[0-5]\\d (?:AM|PM)');
const HOUR_LABEL = new RegExp('(?:1[0-2]|[1-9]) (?:AM|PM)');

async function mainTextWithoutInputs(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return '';
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, script, style').forEach((el) => el.remove());
    return clone.textContent ?? '';
  });
}

/** Profile pages stream in behind a loading state; wait for the real content. */
async function ready(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect
    .poll(() => mainTextWithoutInputs(page), { timeout: 15_000 })
    .not.toMatch(/^\s*Loading\s*$/);
}

async function expectTwelveHourOnly(page: Page, where: string): Promise<void> {
  await ready(page);
  const text = await mainTextWithoutInputs(page);
  expect(text, `${where} shows a 12 hour time; got: ${text.slice(0, 300)}`).toMatch(TWELVE_HOUR);
  expect(text, `${where} still shows a 24 hour time`).not.toMatch(TWENTY_FOUR_HOUR);
}

test('a teacher page prints every time in 12 hour form', async ({ page }) => {
  // Rabia Akhtar has classes in the fixture (the search spec relies on it too).
  await page.goto('/u/lgu/search?q=akhtar');
  await page.locator('main a[href^="/u/lgu/teachers/"]').first().click();
  await page.waitForURL(/\/u\/lgu\/teachers\/[^/]+$/);
  await expectTwelveHourOnly(page, 'teacher page');
});

test('a room page prints every time in 12 hour form', async ({ page }) => {
  await page.goto('/u/lgu/rooms');
  await page.locator('main a[href^="/u/lgu/rooms/"]').first().click();
  await page.waitForURL(/\/u\/lgu\/rooms\/[^/]+$/);
  await expectTwelveHourOnly(page, 'room page');
});

test('the free rooms summary reads the window in 12 hour form', async ({ page }) => {
  await page.goto('/u/lgu/free-rooms?day=1&from=09:30&to=11:00');
  const summary = await page.locator('main p', { hasText: /^\d+ free,/ }).innerText();
  expect(summary).toContain('9:30 AM to 11:00 AM');
  expect(summary).not.toMatch(TWENTY_FOUR_HOUR);
});

// The picker cascade from timetable.spec.ts: land on the first section that
// renders a timetable, driven by URL so it is deterministic.
async function populatedSection(page: Page): Promise<void> {
  await page.goto('/u/lgu/timetable');
  await page.locator('#pick-program').click();
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
      if ((await page.locator('.evt, .evt-dot').count()) > 0) return;
    }
  }
  throw new Error('no section with a rendered timetable was found in the fixture');
}

test('the weekly grid gutter reads "8 AM", never "08:00"', async ({ page }) => {
  await populatedSection(page);
  await page.getByRole('group', { name: 'View' }).getByRole('button').first().click();
  await expect(page.locator('.evt').first()).toBeVisible();
  const text = await mainTextWithoutInputs(page);
  expect(text, `grid text: ${text.slice(0, 300)}`).toMatch(HOUR_LABEL);
  expect(text).toMatch(TWELVE_HOUR);
  expect(text).not.toMatch(TWENTY_FOUR_HOUR);
});
