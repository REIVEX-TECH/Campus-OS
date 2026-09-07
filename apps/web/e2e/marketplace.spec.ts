import { expect, test } from '@playwright/test';
import { pageAs } from './support/sessions';

/**
 * Marketplace goods, signed in: a verified member posts a listing through the API,
 * then it shows in browse and on its detail page, with cash-on-meetup stated. This
 * pins that the module is enabled for LGU and the read path renders; a regression
 * (a broken query, a disabled module, a missing page) fails here.
 */
const ourOrigin = () => ({ origin: String(test.info().project.use.baseURL) });
const stamp = Date.now().toString(36);
const title = `E2E calculator ${stamp}`;

test('a member posts a goods listing that shows in browse and on its detail page', async ({
  browser,
}) => {
  const page = await pageAs(browser, 'member');

  const created = await page.request.post('/api/marketplace/listings', {
    headers: { ...ourOrigin(), 'content-type': 'application/json' },
    data: {
      tenant: 'lgu',
      title,
      description: 'A scientific calculator, barely used.',
      pricePaisa: 150000,
      priceKind: 'fixed',
      category: 'electronics',
      condition: 'used',
    },
  });
  const createdBody = await created.text();
  expect(created.ok(), createdBody).toBeTruthy();
  const { id } = JSON.parse(createdBody) as { id: string };

  // Browse shows the listing.
  await page.goto('/u/lgu/marketplace');
  await expect(page.getByText(title)).toBeVisible();

  // Detail page renders title, price and the cash-on-meetup note.
  await page.goto(`/u/lgu/marketplace/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('Rs', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Cash on meetup', { exact: false })).toBeVisible();
});

test('a phone number in a listing is refused', async ({ browser }) => {
  const page = await pageAs(browser, 'member');
  const res = await page.request.post('/api/marketplace/listings', {
    headers: { ...ourOrigin(), 'content-type': 'application/json' },
    data: {
      tenant: 'lgu',
      title: `Contact test ${stamp}`,
      description: 'reach me at 0300 1234567',
      pricePaisa: 1000,
      priceKind: 'fixed',
      category: 'other',
      condition: 'used',
    },
  });
  expect(res.status()).toBe(422);
});
