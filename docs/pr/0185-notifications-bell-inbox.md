# feat(notifications): bell counts all kinds, inbox merges every source

Block A item 2, part 2. The bell now counts every unread notification (not just
communities) and shows for any signed-in member; the inbox page merges the
communities view with the generic (other-module) notifications; and mark-all-read
goes through a module-agnostic route.

## What

- **Bell** (`app-shell`): uses `@campusos/module-notifications`' kind-agnostic
  `unreadCount` and is shown whenever someone is signed in, no longer gated on
  communities.
- **Inbox** (`/u/[slug]/notifications`): no longer 404s without communities; it
  fetches communities notifications (when the module is on) and the generic
  link-bearing notifications, merges them by time, and renders both. Generic lines
  come from `notificationLineKey(kind)` (a kind -> i18n map with a neutral fallback,
  so a new emitter is never blank), the payload's `title`, and the row's `link`.
- **Mark all read** (`/api/notifications`): a module-agnostic route that marks every
  unread row (all kinds); the existing button now posts here.
- i18n: `notifications.generic.*` for the wired kinds.

## Data & migration impact

No schema change (builds on the notifications seam).

## Tests

Web typecheck, lint, no-dash, and a full build pass. The generic reader/count are
covered by the notifications integration suite; the merge/render is a page assembly.

## Verification

Signed in, the bell shows a count that includes non-communities notifications and
links to `/notifications`; the inbox lists communities and generic notifications
together, newest first; "mark all as read" clears the bell.

## Follow-ups

The per-module emitters (L&F, marketplace, services, messages) are the next PR; until
then the generic section is empty for existing tenants.
