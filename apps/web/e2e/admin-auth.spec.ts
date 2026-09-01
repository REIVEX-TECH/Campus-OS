import { expect, test } from '@playwright/test';

// The admin gate must be real server-side enforcement, not a hidden URL or a
// client-only control. An unauthenticated visitor is redirected away from the
// admin page, and the mutation endpoint itself rejects an unauthenticated POST.
test('admin area is gated server-side on both the route and the mutation', async ({
  page,
  request,
}) => {
  // Route: the admin page redirects an unauthenticated visitor to login.
  await page.goto('/u/lgu/admin/rooms');
  await expect(page).toHaveURL(/\/u\/lgu\/admin\/login/);

  // Mutation: the rename endpoint rejects an unauthenticated POST outright.
  const res = await request.post('/u/lgu/admin/rooms/rename', {
    form: { roomId: '00000000-0000-0000-0000-000000000000', name: 'Room 25 NB' },
  });
  expect(res.status()).toBe(401);
});
