# feat(messages): message requests — schema, service, and the block check (§6)

Block: a new conversation starts as a **request**, not a chat. This is the backend
half (schema + service + a communities block definer + tests); the Requests tab and
composer states land in the follow-up web PR. Adds a SECURITY DEFINER and a
migration, so §6 (concrete SQL) applies.

## What

- **communities `0012_block_between`** — `auth_blocked_between(tenant, other)`, a
  caller-scoped bidirectional block check. `user_blocks` reads are own-row under RLS
  (`blocker_id = app.user_id`), so a caller cannot see whether the other person
  blocked them; direct messages needs both directions to refuse a request or a send.
  `blockedBetween(actor, tenant, other)` in communities' `blocks.ts` calls it. Used
  by the web route (composition, not a cross-module table read).
- **messages `0003_message_requests`** — `msg_conversations` gains `status`
  (`pending` | `active` | `declined`, CHECK-constrained, default `active` so every
  existing conversation is a real chat), `requested_by`, and `status_changed_at`, plus
  a partial index on pending rows. No new policy or definer in messages.
- **service** — `startConversation` opens a **pending** request (the actor is
  `requested_by`); `sendMessage` lets the requester send exactly one message while
  pending (counted since `status_changed_at`), and the recipient's first message
  accepts it (→ active); `acceptRequest` / `declineRequest` (recipient-only);
  `listRequests` / `requestCount` (inbound, kept out of the inbox and counted apart
  from unread); `listInbox` now returns active chats plus the actor's own outbound
  requests, flagged `outbound`; `markRead` no-ops on a request (opening one does not
  mark it read or start after-viewing); ephemerality is stamped only once active.
- A declined request bars the same requester for **30 days** (`declined_recently`);
  after that a fresh request re-opens the row (a new `status_changed_at` starts a new
  one-message window — see §6).

## §6 (concrete SQL)

- **`auth_blocked_between` is a scoped READ, not a privilege decision.** It reports
  only block relationships involving the caller (`app.user_id` is always one side of
  the pair), so it discloses no third party's blocks; the single new fact it yields —
  "this person blocked you" — is exactly what the refusal is built on. It is the same
  class as the existing own-row `user_blocks` SELECT policy, not a §8 privilege
  decision (it makes no write and grants nothing). `search_path = public`; REVOKE
  FROM PUBLIC then GRANT EXECUTE to the app; declared `app` in the DEFINER_INTENT
  registry (the grant-hygiene test enforces this).
- **`user_blocks` moves FORCE → NO FORCE.** FORCE binds the owner too, so the
  definer (run as owner) would still be filtered by the own-row policy and never see
  the reverse block. NO FORCE lets the owner (this definer and migrations) read
  across; the application role is a non-owner and stays fully bound by the unchanged
  RESTRICTIVE own-row policy and the permissive tenant policy, so no app-facing read
  or write widens. Same pattern as the moderation/identity definer-read tables; the
  FORCE-parity test is updated to expect `user_blocks: false`.
- **Status transitions are the recipient's own UPDATE**, already allowed by the
  participant `FOR ALL` policy (0000). Accept/decline add the business rule in the
  WHERE clause (`status = 'pending' AND requested_by <> actor`), so a non-recipient
  or a non-pending row updates nothing; this is participant action, not a privilege
  grant, so app-side enforcement is correct (as the spec allows).
- **No app-role DELETE on `msg_messages`.** That table has SELECT/INSERT/UPDATE
  policies but no DELETE (hard deletes are the owner's cleanup sweep only). So a
  re-request does NOT delete the declined thread; instead `status_changed_at` moves to
  now() and the "one message while pending" rule counts only messages created after
  it, giving the re-request a clean one-message window without a delete. (This is the
  same RLS class as the earlier ephemeral-sweep fix: a DELETE with no policy affects
  zero rows.)

## Data & migration impact

Two migrations: communities `0012` (one definer), messages `0003` (columns + CHECK +
partial index; backwards-compatible, existing rows are `active`). Rollback: drop the
function / the columns. No data backfill.

## Tests

- communities: `auth_blocked_between` reports a block in both directions (the blocked
  party sees it though their own RLS hides the raw row); an uninvolved pair is clear.
- messages: request opens pending with one message, a second is refused, the
  recipient's reply accepts; the requester's own request shows as an outbound entry,
  not in requests; decline hides it from the recipient and keeps the requester's sent
  state; 30-day re-request refusal, then a fresh window after; ephemerality not
  stamped while pending. (Integration suites are CI-only; split-guarded.)

```bash
pnpm -C packages/modules/messages test:integration
pnpm -C packages/modules/communities test:integration
```

## Follow-ups

- The web PR: Requests tab, request card (Accept / Decline / Block), the disabled
  "Request sent" composer, and the bidirectional block check wired at the create/send
  routes via `blockedBetween`. Enabling for LGU stays a separate morning decision.
