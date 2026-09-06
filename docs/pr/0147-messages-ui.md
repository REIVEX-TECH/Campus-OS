# feat(messages): inbox, thread, and the profile Message button

Block 3, third PR. The web surface for direct messages: an inbox, a conversation
thread with an optimistic composer and light polling, message actions, and the
Message button on the profile that Block 2 deferred. No RLS/definer/grant change
(the module core and moderation carry those), so §6 does not apply here.

## What

- **Inbox** (`/u/[slug]/messages`): the member's conversations, most-recent first,
  each with the other party's handle/avatar, a last-message preview, a relative
  time, and an unread badge.
- **Thread** (`/u/[slug]/messages/[id]`): the messages, a composer that sends
  **optimistically** and reconciles on the server refresh, a light **poll** (every
  3s while the tab is visible) so the other side's replies appear, a **read**
  marker when the other party has seen your latest, and per-message actions —
  **edit** and **delete for everyone** on your own (within the tenant's windows),
  **report** on someone else's ("Reporting saves a copy for moderators").
- **Message button** on the public profile (`/u/[slug]/people/[handle]`): opens or
  reuses a conversation and goes to the thread — shown only when the module is
  enabled, the viewer is not the member, and neither has blocked the other
  (sender-side block honored via communities' `isBlocked`, composed at the route).
- **Module wiring**: `apps/web/lib/messages.ts` (enabled/require/settings), a
  `messages-route.ts` gate (same-origin + rate-limit + zod + tenant + enabled),
  the nav card in `apps/web/lib/modules.ts` (a new `mail` icon), and the JSON
  routes: `POST /api/messages/conversations` (start), `POST /api/messages/[id]`
  (send / mark-read), `POST /api/messages/m/[messageId]` (edit / delete / report).

## Service change

`listInbox` and `thread` now resolve the other participant's handle and avatar via
the `public_profiles` view (the same cross-module public-identity read L&F uses for
a reporter handle) — additive fields, no behavior change to the existing ones.

## Delivery model

Polling, not websockets (§2): the thread polls every 3s and pauses when the tab is
hidden; the server render is the source of truth and an optimistic bubble is
dropped as soon as the refresh brings the real message. Rate limits: the start
route is 20/min per client, the thread and message routes 60/min, on top of the
module's own per-day / per-minute caps and RLS.

## Data & migration impact

**No schema change, no migration.** UI + routes + two additive service fields.

## Tests

The module's RLS, service, and moderation guarantees are covered by the merged
`messages.integration.test.ts` (core + moderation PRs). This PR is UI/routes over
those; `pnpm --filter web build` compiles the pages and routes, and the no-dash
copy gate passes.

```bash
pnpm --filter web build
pnpm --filter web test
```

## Verification

- `/u/lgu/people/<handle>` (once messages is enabled): a **Message** button opens
  a thread; send a message; the other member sees it within ~3s; opening the thread
  marks it read and the sender sees "Read"; edit within 5 min; delete for everyone
  within 1 hr; report the other's message → "Reported".
- `/u/lgu/messages`: the conversation appears with an unread badge until opened.

## Follow-ups

- **Enable for LGU** (config flip) — the next PR, once this UI is in (the §8
  release: reporting + blocking + moderation + UI all present before enablement).
- Ephemerality (`after_24h` / `after_viewing`) + delete-for-me + the 15-min
  cleanup cron (schema columns reserved).
- Bidirectional block refuse (recipient-blocked-you) needs a shared block definer;
  today the sender-side block is honored and either party can block from the profile.
- The sidebar unread count (the inbox shows per-conversation unread; a global badge
  can reuse `unreadCount`).
