# feat(notifications): bell counts all kinds, inbox merges, and the emitters

Block A item 2, part 2. The bell now counts every unread notification (not just
communities) and shows for any signed-in member; the inbox page merges the
communities view with the generic (other-module) notifications; mark-all-read goes
through a module-agnostic route; and the deferred emitters (services orders,
messages, Lost & Found claims) now fire through the seam.

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

## Emitters wired

- **Services orders**: placeOrder tells the seller; every transition tells the other
  party (`services.order_update`, link `orders/<id>`), inside the same transaction.
- **Messages**: a new/re-opened request tells the recipient; accepting a request
  tells the requester (`messages.request` / `messages.request_accepted`).
- **Lost & Found**: opening a claim tells the item's reporter; a claim message tells
  the other participant; confirming tells the approved claimant and the (now denied)
  others; rejecting tells the claimant. Recipients are all readable by the actor as a
  participant or from the public item, so no new definer is needed.

Links are stored **base-relative** (e.g. `orders/abc`); the inbox prepends the tenant
base so they work on the platform host and custom domains.

## Follow-ups

**Marketplace goods emitters (saved-listing sold / price-changed, report resolved) are
deferred**: their recipients (savers, reporters) are other users the acting member
cannot read under RLS, so each needs its own owner-run recipient-lookup definer (the
`communities_notify` pattern) with a §6 pass. Logged in DECISIONS.md.
