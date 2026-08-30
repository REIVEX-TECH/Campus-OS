import { expect, test } from '@playwright/test';

test('picker → section grid renders and the ICS feed responds', async ({ page, request }) => {
  await page.goto('/u/lgu/timetable');

  const sectionLink = page.locator('a[href^="/u/lgu/sections/"]').first();
  await expect(sectionLink).toBeVisible();
  await sectionLink.click();

  // The accessible weekly grid renders with a caption.
  await expect(page.locator('table caption')).toBeVisible();

  // The ICS feed returns a valid calendar containing at least one UID.
  const subscribe = page.getByRole('link', { name: /subscribe/i });
  await expect(subscribe).toBeVisible();
  const href = await subscribe.getAttribute('href');
  expect(href).toBeTruthy();

  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  expect(await res.text()).toContain('UID:');
});
