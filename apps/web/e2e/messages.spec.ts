import { expect, test } from '@playwright/test';
import { pageAs, sessionFor } from './support/sessions';

/**
 * Messages, end to end, signed in: an owner starts a request from a member's
 * profile (the compose sheet opens with the recipient fixed and a body field, not
 * a search), the member sees the request in the list with its message and accepts
 * it, and the thread renders for both. This pins the client data layer: the list,
 * the thread and the recipient search all read through GET routes, and a regression
 * that makes those return empty (as the same-origin gate once did on a GET that
 * carries no Origin header) leaves "No messages yet" everywhere and fails here.
 */
const stamp = Date.now().toString(36);
const firstMessage = `Hi from the owner ${stamp}`;
const state = { conversationId: '' };

test.describe.serial('messages, end to end', () => {
  test('compose from a profile fixes the recipient and sends the first message', async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'owner');
    const member = sessionFor('member').handle;
    await page.goto(`/u/lgu/people/${member}`);

    await page.getByRole('button', { name: 'Message', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a message' });
    await expect(sheet).toBeVisible();

    // From a profile the recipient is fixed: the chip carries the member's handle
    // and the body field is the only input. The recipient search must not appear.
    await expect(sheet.getByText(member)).toBeVisible();
    await expect(sheet.getByPlaceholder('Write a message')).toBeVisible();
    await expect(sheet.getByPlaceholder('Search people by handle')).toHaveCount(0);

    await sheet.getByPlaceholder('Write a message').fill(firstMessage);
    await sheet.getByRole('button', { name: 'Send', exact: true }).click();

    // Lands on the new conversation; the thread renders the message we just sent
    // rather than the empty state the read bug produced.
    await page.waitForURL(/\/u\/lgu\/messages\/[0-9a-f-]{8,}$/i);
    state.conversationId = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(state.conversationId).not.toBe('');
    await expect(page.getByText(firstMessage)).toBeVisible();
    await expect(page.getByText('No messages yet. Say hello.')).toHaveCount(0);
  });

  test('the recipient sees the request and its message in the list, and accepts', async ({
    browser,
  }) => {
    const page = await pageAs(browser, 'member');
    const owner = sessionFor('owner').handle;
    await page.goto('/u/lgu/messages');

    // The inbox GET works: the request is in the Requests section, carrying its
    // one message, not the "No messages yet" the read bug produced.
    await expect(page.getByText(/Requests \(1\)/)).toBeVisible();
    await expect(page.getByText(owner)).toBeVisible();
    await expect(page.getByText(firstMessage)).toBeVisible();
    await expect(page.getByText('No messages yet. Start one')).toHaveCount(0);

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    // Accepting turns the request into an active chat; it leaves the requests list.
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  });

  test('the recipient opens the thread and it renders the message', async ({ browser }) => {
    const page = await pageAs(browser, 'member');
    await page.goto(`/u/lgu/messages/${state.conversationId}`);
    // The thread GET works for the other participant too.
    await expect(page.getByText(firstMessage)).toBeVisible();
    await expect(page.getByText('No messages yet. Say hello.')).toHaveCount(0);
  });

  test('the recipient search finds a member by handle', async ({ browser }) => {
    const page = await pageAs(browser, 'member');
    const owner = sessionFor('owner').handle;
    await page.goto('/u/lgu/messages');

    await page.getByRole('button', { name: 'New message', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a message' });
    await expect(sheet).toBeVisible();

    await sheet.getByPlaceholder('Search people by handle').fill(owner);
    // The recipients GET works: the match appears rather than "No one found."
    await expect(sheet.getByText(owner)).toBeVisible();
    await expect(sheet.getByText('No one found.')).toHaveCount(0);
  });
});
