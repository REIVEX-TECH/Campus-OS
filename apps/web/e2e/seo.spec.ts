import { expect, test } from '@playwright/test';

// The sitemap and robots are host-based. On a tenant host (see playwright.config
// for the nested-host setup) the sitemap enumerates the tenant's public URLs.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const NESTED = `lgu.localhost:${PORT}`;

test('the tenant sitemap enumerates every public URL type', async ({ request }) => {
  const res = await request.get('/sitemap.xml', { headers: { Host: NESTED } });
  expect(res.status()).toBe(200);
  const xml = await res.text();

  // Static pages.
  expect(xml).toContain('/timetable');
  expect(xml).toContain('/free-rooms');
  expect(xml).toContain('/search');
  // Dynamic public pages (the e2e DB is seeded with real data).
  expect(xml).toContain('/sections/');
  expect(xml).toContain('/courses/');
  expect(xml).toContain('/teachers/');
  expect(xml).toContain('/rooms/');
  // The "coming soon" module stubs.
  expect(xml).toContain('/soon/marketplace');
  // URLs are the nested tenant host, absolute.
  expect(xml).toContain(`http://${NESTED}/`);
});

test('the tenant home carries CollegeOrUniversity structured data', async ({ request }) => {
  const res = await request.get('/', { headers: { Host: NESTED } });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('application/ld+json');
  expect(html).toContain('"@type":"CollegeOrUniversity"');
  expect(html).toContain('Lahore Garrison University');
});

test('the platform landing carries WebSite structured data and social cards', async ({ page }) => {
  // The default baseURL is the platform host (localhost:<port>).
  await page.goto('/');
  const html = await page.content();
  expect(html).toContain('"@type":"WebSite"');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'CampusOS');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
});
