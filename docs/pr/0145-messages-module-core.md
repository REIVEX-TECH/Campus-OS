# feat(messages): direct-messages module core (§6)

Block 3, first PR. A new `messages` module for private 1:1 direct messages, with
the design docs it is built to. This PR is the **core**: the data model, its
participant-only RLS, and the send/read/edit/delete services with tests. It adds
RLS, so §6 (concrete SQL) applies. It is not yet enabled for any tenant and has no
UI — those, plus moderation, ephemerality, blocks, and the cleanup cron, follow.

## Design

`docs/design-messages.md` (the full design) and `docs/design-calls.md` (calls,
out of scope, one page). The decisions there are settled; this PR implements the
core of the sequence's PR 1–2.

## What (migration 0000)

Three tenant-scoped tables, all under RLS:

- **`msg_conversations`** — one row per ordered pair (`participant_a < participant_b`,
  a CHECK + a unique `(tenant, a, b)`), with `ephemerality` and `last_message_at`.
- **`msg_participant_state`** — each participant's `last_read_at` (read receipts)
  and `cleared_at` (reserved for delete-for-me), keyed `(conversation, participant)`.
- **`msg_messages`** — `body`, `reply_to_id`, `edited_at`, `deleted_at`
  (delete-for-everyone tombstone), and reserved `expires_at` / `first_viewed_at`
  for ephemerality (a later PR).

## §6 (concrete SQL)

- **Participant-only visibility.** Every policy keys on the actor being one of the
  conversation's two participants (`participant_a`/`participant_b` = `app.user_id`)
  AND the tenant matching `app.tenant_id`. A message and a read-state row resolve
  their conversation through an `EXISTS` on `msg_conversations`, which is itself
  RLS-filtered, so a non-participant sees nothing — not the conversation, not a
  single message row.
- **ENABLE, not FORCE** — the lost-found-claims choice (0001): a later moderation
  migration adds an owner-run definer that must read a reported message across
  participants, and FORCE would bind the owner and hide it. The application role is
  a non-owner and stays confined by the policies regardless.
- **Writes are the actor's own**: a conversation is created only with its creator
  as a participant (WITH CHECK); a message is inserted only by its sender into a
  conversation they belong to; a message is edited/tombstoned only by its sender;
  a read-state row is written only by that participant. Read receipts are the one
  cross-participant READ (both see both state rows) so a sender can see "read".
- No definers in this PR, so the DEFINER_INTENT registry is untouched (the
  moderation PR adds `messages.moderate` and its definer).

## Services

`startConversation` (verified-to-initiate, `whoCanMessage` policy, one row per
pair, new-conversations/day cap), `sendMessage` (reply-to validated in-conversation,
`maxBodyLength`), `listInbox` + `unreadCount`, `thread` (with the other side's read
marker; tombstoned messages show blank), `markRead`, `editMessage` (within the
edit window, own only), `deleteForEveryone` (within the delete window, own only).
Blocks are composed at the route layer (the block list is communities' — §4), not
in the module.

## Data & migration impact

New module migration `0000_messages` (own bookkeeping `__drizzle_migrations_messages`,
`when` band `1756800300000`). Registered in `scripts/migrate-all.ts`; root
workspace dep added. No change to any other module's schema. Applies cleanly
(verified locally against the dev DB up to the split check).

## Tests

`messages.integration.test.ts` (split DB): a conversation and its messages are
confined to the two participants (an outsider sees nothing, a raw insert as an
outsider is refused); tenants are isolated; one row per pair, reused; `whoCanMessage`

- self are enforced; read receipts + unread counts track; edit is windowed and
  own-only; delete-for-everyone tombstones the row (keeps its place, drops the words).

```bash
pnpm -C packages/modules/messages test:integration
```

## Follow-ups (the rest of the sequence)

- Delete-for-me + ephemerality (`after_24h` / `after_viewing`) + the 15-min
  cleanup cron + runbook.
- Moderation: report-with-snapshot + a `messages.moderate` definer + queue (§6).
- UI: inbox + thread, polling, optimistic send, unread surfacing; the Message
  button on the profile (Block 2 deferred it here).
- Blocks honored both ways (composed at the route), verified-recipient nuance,
  and enable for LGU.
