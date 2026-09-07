# feat(messages): unread badge on the Messages sidebar item

The inbox already shows per-conversation unread; this surfaces the total on the
Messages nav item, next to the existing notifications bell for communities.

## What

- `AppShell` computes the direct-messages unread total once per page (only when the
  module is enabled and someone is signed in) via the existing
  `unreadCount(userId, tenant)`, and sets it as a `badge` on the Messages nav item.
- The `Sidebar` renders a `badge` as a small count pill on a nav item (capped at
  `99+`); it follows the label's visibility, so the collapsed icon rail stays clean.

Requests are counted separately (the Requests tab has its own count) and are not
in this total — the badge is unread messages in active conversations only, matching
`unreadCount` (which sums the inbox, where outbound requests contribute zero).

## Data & migration impact

No schema change. UI only.

## Tests

`apps/web` typecheck + unit suite green. It reuses the covered `unreadCount`
service function; the change is a nav-render addition.

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web test
```

## Verification

Local browser-view is blocked by the pre-existing local tenant-resolution 404;
verified by typecheck + build. Once messages is enabled for LGU, an unread message
shows a count pill on the Messages item that clears when the thread is read.
