# feat(messages): message requests — Requests tab, request states, block wiring

The web half of message requests (stacked on the core PR). No new SQL: it composes
the service functions and the `blockedBetween` definer the core PR added.

## What

- **Inbox** (`/u/[slug]/messages`) gains a **Messages / Requests** tab pair; the
  Requests tab shows a count and lists inbound requests as cards. The Messages tab
  renders the actor's own outbound requests as "Request sent" (no preview, no
  timestamp, no unread).
- **Request card** (`request-card.tsx`): handle, avatar, the one message, and
  Accept / Decline / Block. Accept turns it into a chat; Decline hides it; Block
  does both (decline + block in one action). The list re-renders after each.
- **Thread** (`conversation.tsx`): for a request the actor received, an Accept /
  Decline / Block bar and a composer whose reply accepts; for a request the actor
  sent, a "Request sent — waiting to be accepted" panel with no composer. The
  composer is disabled whenever `canSend` is false, and the disappearing-messages
  selector is hidden until the conversation is active.
- **Routes**: `/api/messages/[id]` gains `accept`, `decline`, and `decline_block`
  actions, and the `send` action now refuses when either party has blocked the other
  (via `otherParticipant` + `blockedBetween`) — the block is checked at every send,
  as well as at conversation creation (the create route, in the core PR).

## Data & migration impact

No schema change. UI + routes only.

## Tests

`apps/web` unit suite green (typecheck + no-dash + 120 tests). The request lifecycle
and the bidirectional block are covered by the core PR's integration suites; these
are the client/route surfaces over them.

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web test
```

## Verification

Local browser-view of the tenant pages is blocked by the pre-existing local
tenant-resolution 404 (noted on the L&F PRs); verified by typecheck + the build.
Enabling messages for LGU remains a separate morning decision (with the
messages-cleanup cron); once enabled, the full flow is: Message from a profile →
"Request sent"; the recipient's Requests tab → Accept/Decline/Block; a reply
accepts; a blocked pair is refused either way.

## Follow-ups

- The global sidebar unread badge (separate queued item) is next.
