# fix(messages): prune every empty conversation and guard accept

An active conversation with zero messages ("Ruby_Feather_8181, No messages yet")
survived the 0004 cleanup, which pruned only pending empties. Any conversation
with no messages reads as "No messages yet" in an inbox and is never legitimate
now that every conversation is born with its first message, so this removes them
regardless of status and closes the one write path that could create one.

## What

- **Migration `0006_prune_empty_conversations.sql`:** deletes any conversation
  with zero messages, whatever its status (0004 deleted only `pending`). Runs as
  the owner (`msg_conversations` is not FORCE), so RLS does not filter it;
  `msg_participant_state` cascades on the FK and there are no messages to remove.
  Idempotent.
- **`acceptRequest` guard:** the accept only flips a request to `active` if it
  actually carries a message (`and exists (select 1 from msg_messages ...)`). A
  request is always created with its first message, so this holds for every real
  one; the guard means accept can never mint an empty active conversation. The
  message existence is checked with the bound conversation id, not an unqualified
  `id` (which would resolve to `msg_messages.id` and always be false).

## Why an active empty could exist

A conversation becomes active only through a message: the recipient's reply, or
`acceptRequest` over a request that already holds the requester's first message.
The empty active rows are legacy data from the pre-request create-empty flow,
which 0004 did not reach.

## Data & migration impact

- Migration: `packages/modules/messages/drizzle/0006_prune_empty_conversations.sql`
  (data-only DELETE), registered in the module journal. Backwards compatible; no
  schema change. Rollback: none needed (it removes stale rows); to reverse, restore
  from backup. Runs in the messages module's migration set.

## Tests

- Integration (`messages.integration.test.ts`): a new case seeds a pending
  request, strips its message to mimic the legacy empty state, and asserts accept
  refuses and the conversation stays `pending`, so accept cannot mint an empty
  active chat. The existing request/accept cases still pass (they always carry a
  message at accept time).
- Typecheck, lint and format on the messages package are green. Integration is
  CI-only (needs the split RLS database).

## Verification

1. Run migrations; the "No messages yet" active conversations are gone from every
   inbox.
2. A normal request still accepts and becomes an active chat.

## Follow-ups

None.
