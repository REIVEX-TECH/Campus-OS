# feat(messages): delete-for-me (clear a conversation)

Block A item 4. A participant can clear a conversation for themselves: the thread,
the inbox preview, and the unread count then show nothing on or before the clear;
the other person is unaffected, and a later message reopens the thread from there.
Uses the `cleared_at` column already in the schema (design-messages.md), so no
migration.

## What

- `clearConversation(actor, tenant, conversationId)`: stamps the actor's
  `msg_participant_state.cleared_at` to now (own state only, by RLS); refuses a
  conversation the actor is not in.
- `thread`, `listInbox` preview, and the unread count now filter to messages after
  the actor's `cleared_at`.
- A `clear` action on `POST /api/messages/[id]`, and a "Clear chat" button in the
  thread header (with a confirm) that clears and refetches.
- i18n `messages.clearChat` / `messages.clearConfirm`.

## Data & migration impact

No schema change (the `cleared_at` column existed but was unwired).

## Tests

`messages.integration.test.ts` gains a delete-for-me block: after A clears, A's
thread is empty while B still sees both messages; a new message from B reappears for
A from that point; and a non-participant cannot clear. Messages + web typecheck,
lint, no-dash, and a full build pass.

## Follow-ups

Per-message delete-for-me (`deleted_for`) is also sketched in design-messages.md;
this ships the conversation-level clear (the column that exists). Next: security
backlog M3 (item 5).
