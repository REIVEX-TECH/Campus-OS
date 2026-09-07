# fix(messages): a request must carry a message (no empty conversations)

**Item 2 of the messages feedback.** Today the Message button creates an empty
conversation and the first message is sent afterwards, so an empty request can
appear in an inbox as "No messages yet". This makes a request and its first message
one atomic act, and removes the create-empty path.

## What

- **Service** — `startConversation(actor, tenant, other, body, settings, ephemerality?)`
  now takes the first message and, in ONE transaction, creates the pending request
  AND inserts that message (or, if a conversation already exists, lands the message
  in it: a recipient's message accepts an inbound request, an active chat just
  continues, a declined pair re-opens subject to the 30-day bar). A blank body is
  refused before anything is created. New `conversationBetween` lets the profile
  button decide link-vs-compose.
- **Create route** (`/api/messages/conversations`) now requires `body`; there is no
  way to create an empty conversation.
- **Migration `0004_prune_empty_requests`** deletes existing pending conversations
  with zero messages (participant-state cascades). Active conversations are kept.
- **UI** — the profile **Message button** opens a compose sheet (a bottom sheet on
  mobile, a centred dialog on desktop, reusing the filter-sheet pattern) with one
  field; on send it creates the request-with-message and goes to the thread. If a
  conversation already exists (active or a request in flight) the button is just a
  link to it.

## Data & migration impact

`messages/0004` is a data cleanup (a `DELETE` of empty pending rows, owner-run;
`msg_conversations` is not FORCE so RLS does not filter it). No schema/RLS/definer
change, so no §6 review. Backwards-compatible; rollback is a no-op (the deleted rows
were unreachable empties).

## Tests

- New: **a request cannot exist without a message** — a blank body creates nothing,
  and a real request carries its one message with no second allowed while pending.
- Updated: the request-lifecycle and ephemerality suites fold the first message into
  `startConversation`; the `open()` helper seeds + accepts + clears the seed so
  active-chat tests still start empty.

```bash
pnpm -C packages/modules/messages test:integration
```

## Verification

Local browser-view is blocked by the known local tenant-resolution 404; verified by
typecheck + the integration suite (real Postgres + RLS). The atomic create is the
guarantee: `startConversation` inserts the conversation and the message in one
transaction, and the create route rejects a missing body.
