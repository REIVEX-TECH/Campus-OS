import { expect, test } from '@playwright/test';
import { pageAs } from './support/sessions';

/**
 * A photo posted with a Lost & Found item round-trips through the media pipeline
 * and serves back from /media. This pins two things a browser depends on: the
 * upload endpoint accepts a real image (magic-byte + sharp), and /media is served
 * (not swallowed by the tenant rewrite). A regression in either fails here.
 */

// A 1x1 PNG. sharp decodes it and re-encodes to WebP; the bytes only need to be a
// genuine image, which a fake would not be.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('a member posts a lost-found item with a photo that serves from /media', async ({
  browser,
}) => {
  const page = await pageAs(browser, 'member');
  await page.goto('/u/lgu/lost-found/post');

  await page.getByRole('textbox', { name: 'Title' }).fill('Lost umbrella e2e');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  // Lands on the new item page, which renders the photo from /media.
  await page.waitForURL(/\/u\/lgu\/lost-found\/[0-9a-f-]{8,}$/i);
  const img = page.locator('img[src^="/media/"]').first();
  await expect(img).toBeVisible();

  // The photo actually serves: fetch its URL and confirm a 200 image response.
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type'] ?? '').toContain('image/');
});
