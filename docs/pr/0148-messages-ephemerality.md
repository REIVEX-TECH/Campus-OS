# feat(messages): disappearing messages and the cleanup sweep (§6)

Block 3, fourth PR. Per-conversation ephemerality — `after_24h` and
`after_viewing` — with a hard-delete cleanup sweep. Adds a DELETE policy and a
SECURITY DEFINER, so §6 (concrete SQL) applies.

## What (migration 0002)

- A **DELETE policy** on `msg_messages` for the cleanup sweep: the application
  role, in the tenant context (no actor), may delete ONLY rows whose `expires_at`
  has passed. It keys on the tenant GUC + `expires_at`, never on `app.user_id` —
  a maintenance capability scoped to already-expired rows, not an authorization
  decision, so it can delete nothing that has not expired and never crosses a
  tenant.
- **`auth_msg_stamp_viewed(tenant, conversation, grace)`**: an owner-run definer
  that stamps `first_viewed_at` + a short `expires_at` on the inbound messages of
  an `after_viewing` conversation when the recipient first reads them. The viewer
  is not the sender, so the own-message UPDATE policy (0000) would block them; the
  definer does it, gated on the caller being a participant (read through the
  RLS-filtered `msg_conversations`, so a non-participant stamps nothing), and only
  on that conversation's not-yet-viewed inbound messages.

## §6 (concrete SQL)

- The definer requires the caller be a participant of the specific after_viewing
  conversation; it touches no other conversation and stamps only inbound,
  unviewed, non-deleted messages. App-callable and self-gating (declared `app` in
  the DEFINER_INTENT registry).
- The DELETE policy cannot remove a live message: `expires_at IS NOT NULL AND
expires_at <= now()`. Expired messages are already hidden from every read.

## Service + UI

- `startConversation` takes an optional ephemerality; `setEphemerality` lets
  either participant change it; `sendMessage` stamps `expires_at = created_at +
24h` for `after_24h`; `markRead` calls the stamp definer for `after_viewing`
  (grace from the tenant setting). Every read query (`thread`, inbox preview,
  unread) now filters out `expires_at <= now()`.
- A **Disappearing** selector on the thread (Off / After 24 hours / After
  viewing), posting to the conversation route.
- **Cleanup sweep**: `expireMessages(tenant)` + `scripts/messages-cleanup.ts`
  (`pnpm messages:cleanup -- --tenant lgu`) + `docs/runbooks/messages-cleanup.md`
  (every 15 minutes). Read queries hide expired messages immediately; the sweep
  removes them from the table.

## Data & migration impact

Module migration `0002_messages_ephemerality` (journal idx 2): one DELETE policy,
one definer. No table change (the `expires_at` / `first_viewed_at` columns were
reserved in 0000). Applies cleanly (verified locally against the dev DB up to the
split check).

## Tests

`messages.integration.test.ts` gains an ephemerality suite (split DB): `after_24h`
stamps at send, a message past its window is hidden from reads and then
hard-deleted by `expireMessages` (idempotent); `after_viewing` has no expiry until
the recipient reads, then does; a participant can change the mode.

```bash
pnpm -C packages/modules/messages test:integration
```

## Follow-ups

- **Enable for LGU** (config flip) — still left for a morning browser pass; the
  feature (with disappearing messages) is now complete.
- delete-for-me (a per-message hide) and the bidirectional block refuse remain the
  only messages items outstanding (both logged in the morning report).
