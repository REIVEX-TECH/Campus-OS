import { expect, test } from '@playwright/test';
import { pageAs, sessionFor } from './support/sessions';

/**
 * One community, end to end, signed in: an owner starts it and posts, a member
 * joins, posts anonymously, comments, votes and reports, the owner works the
 * queue, removes with a reason and bans, and the banned member cannot post.
 * Along the way the anonymity model is checked where it matters: nothing a
 * moderator sees carries the anonymous author's handle.
 */
const stamp = Date.now().toString(36);
const state: { slug: string; postPath: string; anonPath: string } = {
  slug: '',
  postPath: '',
  anonPath: '',
};

test.describe.serial('a community, end to end', () => {
  test('an owner starts a community and posts in it', async ({ browser }) => {
    const page = await pageAs(browser, 'owner');
    await page.goto('/u/lgu/c/new');
    await page.locator('main form input').first().fill(`E2E Club ${stamp}`);
    await page.locator('main form button[type=submit]').click();
    // The form lands on the new community's page; /c/new itself must not count.
    await page.waitForURL(
      (url) => /\/u\/lgu\/c\/[a-z0-9-]+$/.test(url.pathname) && !url.pathname.endsWith('/c/new'),
    );
    state.slug = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(state.slug).not.toBe('');

    await page.goto(`/u/lgu/c/${state.slug}/submit`);
    await page.getByLabel(/^Title/).fill('Welcome to the club');
    await page.locator('main form button[type=submit]').click();
    await page.waitForURL(/\/post\//);
    state.postPath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to the club');
  });

  test('a member joins, posts anonymously, comments, votes and reports', async ({ browser }) => {
    const page = await pageAs(browser, 'member');
    await page.goto(`/u/lgu/c/${state.slug}`);
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible();

    await page.goto(`/u/lgu/c/${state.slug}/submit`);
    await page.getByLabel(/^Title/).fill(`Anonymous question ${stamp}`);
    await page.getByLabel(/anonymous/i).check();
    await page.locator('main form button[type=submit]').click();
    await page.waitForURL(/\/post\//);
    state.anonPath = new URL(page.url()).pathname;
    // The author sees it as theirs, with "Anonymous" where a name would be. (Their own
    // handle is in the top bar, so the no-leak check belongs to the moderator's view.)
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText('Anonymous').first()).toBeVisible();

    await page.goto(state.postPath);
    await page.getByPlaceholder('Write a comment').fill('First!');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText('First!')).toBeVisible();
    const upvote = page.locator('article button[aria-label="Upvote"]').first();
    await upvote.click();
    await expect(upvote).toHaveAttribute('aria-pressed', 'true');

    // The post's own row: comments carry Report and Send too.
    const card = page.locator('article').first();
    await card.getByRole('button', { name: 'Report', exact: true }).click();
    await card.getByRole('button', { name: /send/i }).click();
    await expect(card.getByRole('status')).toBeVisible();
  });

  test('the moderator sees no anonymous author anywhere, removes with a reason and bans', async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'owner');
    const member = sessionFor('member').handle;
    // Report the anonymous post so it reaches the queue, then look everywhere a moderator looks.
    await page.goto(state.anonPath);
    await expect(page.getByText('Anonymous').first()).toBeVisible();
    const anonCard = page.locator('article').first();
    await anonCard.getByRole('button', { name: 'Report', exact: true }).click();
    await anonCard.getByRole('button', { name: /send/i }).click();
    for (const path of [state.anonPath, `/u/lgu/c/${state.slug}`, `/u/lgu/c/${state.slug}/mod`]) {
      await page.goto(path);
      expect(await page.content(), path).not.toContain(member);
    }
    await expect(page.getByText('Anonymous author')).toBeVisible();

    // The welcome post was reported by the member; remove it with a reason.
    const row = page.locator('li', { hasText: 'Welcome to the club' }).first();
    await row.getByRole('button', { name: 'Remove' }).click();
    await row.getByLabel(/^Reason/).fill('Off topic for this club');
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('li', { hasText: 'Welcome to the club' })).toHaveCount(0);

    await page.goto(`/u/lgu/c/${state.slug}/members`);
    await page
      .getByRole('combobox', { name: 'Member', exact: true })
      .selectOption({ label: member });
    await page.getByLabel(/^Ban/).check();
    await page.getByLabel('Reason', { exact: true }).fill('Spamming the club');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Done.')).toBeVisible();
  });

  test('the removed post is a notice to a member, and the banned member cannot post', async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'member');
    await page.goto(state.postPath);
    await expect(page.getByText('Removed by moderators')).toBeVisible();

    // Banned, the member holds no permission in the community: no compose form, no New post.
    await page.goto(`/u/lgu/c/${state.slug}/submit`);
    await expect(page.getByText('You do not have permission to do that here.')).toBeVisible();
    await expect(page.locator('main form')).toHaveCount(0);
    await page.goto(`/u/lgu/c/${state.slug}`);
    await expect(page.getByRole('link', { name: 'New post' })).toHaveCount(0);
  });
});
