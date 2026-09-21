import { expect, type Page } from '@playwright/test';

/**
 * Shared timetable-picker cascade helpers for the e2e specs. The picker state lives in
 * the URL path (/timetable/t/{term}/p/{program}/s/{section}); these read the term and
 * program ids from the searchable comboboxes and the section ids from the native
 * select, then drive the cascade by navigating the path form directly, which is
 * deterministic (no soft-navigation click races). One copy so the specs cannot drift.
 *
 * Not a `.spec` file, so Playwright's default testMatch does not run it as a test.
 */

export async function firstTermId(page: Page): Promise<string> {
  await page.goto('/u/lgu/timetable');
  await page.locator('#pick-term').click();
  const ids = await page
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
  const term = ids.find((v): v is string => Boolean(v));
  if (!term) throw new Error('no term with sections in the fixture');
  return term;
}

export async function programIds(page: Page, term: string): Promise<string[]> {
  await page.goto(`/u/lgu/timetable/t/${term}`);
  await page.locator('#pick-program').click(); // enabled once a term is in the path
  const ids = await page
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
  return ids.filter((v): v is string => Boolean(v));
}

export async function sectionIds(page: Page, term: string, program: string): Promise<string[]> {
  await page.goto(`/u/lgu/timetable/t/${term}/p/${program}`);
  return page
    .locator('#pick-section option:not([disabled])')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
}

/**
 * Land on the first section that renders a timetable, returning its ids. Leaves the
 * page on that section's picker view, so a caller can either use the returned ids (e.g.
 * to open /sections/{id}) or assert against the inline render directly.
 */
export async function cascadeToPopulatedSection(
  page: Page,
): Promise<{ term: string; program: string; section: string }> {
  const term = await firstTermId(page);
  const programs = await programIds(page, term);
  expect(programs.length).toBeGreaterThan(0);
  for (const pid of programs) {
    for (const sid of await sectionIds(page, term, pid)) {
      await page.goto(`/u/lgu/timetable/t/${term}/p/${pid}/s/${sid}`);
      // A populated section renders class blocks (grid) or dots (list). Count is
      // DOM-attached, so it is not subject to the visibility-probe timing.
      if ((await page.locator('.evt, .evt-dot').count()) > 0) {
        return { term, program: pid, section: sid };
      }
    }
  }
  throw new Error('no section with a rendered timetable was found in the fixture');
}
