# feat(messages): typing indicator, and immediate poll resume on focus

**Item 3 of the messages feedback.** A typing indicator for active conversations,
plus the poll fixes the item asked to confirm.

## What

- **Migration `0005_typing_indicator`** adds `msg_participant_state.typing_until`.
  It is the actor's own row under the existing own-row policies (both participants
  may read state rows), so no new policy or definer.
- **`setTyping(actor, tenant, id, on)`** stamps `typing_until = now() + 5s` (or
  clears it), **only in active conversations** (a no-op otherwise, so a pending
  request never advertises typing). `thread()` now returns `otherTyping` (the other
  participant's `typing_until` is in the future, active only).
- **Composer** posts a throttled `typing` heartbeat (at most every 2s while typing),
  and clears it on **send** and on **blur**. The thread shows "Typing…" at the
  bottom while the other side is typing.
- **Route** `/api/messages/[id]` gains a `typing` action; the thread gate is raised
  to 120/min so the heartbeat cannot crowd out sends.

## Polling (the verification the item asked for)

- **Delivery within 3s, no reload:** the thread already polls `router.refresh()`
  every 3s while visible, which re-runs the server component and updates the
  messages on both sides. Unchanged and confirmed by construction.
- **Resume immediately on focus:** added `visibilitychange` + `focus` listeners
  that mark read and `router.refresh()` the moment the tab becomes visible, so a
  returning tab does not wait up to 3s. The typing indicator rides the same poll.

## Data & migration impact

`messages/0005`: one nullable column. No RLS/definer/grant change, so no §6. Rollback
is dropping the column.

## Tests

New: the other side's typing shows in an active chat (and not on one's own view),
clears on `setTyping(false)`, and a pending request never advertises typing.

```bash
pnpm -C packages/modules/messages test:integration
```

## Verification

Local browser-view is blocked by the known local tenant-resolution 404, so the live
"Typing…" and the focus-resume are verified by construction (the poll + listeners)
and the integration test for `otherTyping`; the 3s cadence is the existing poll.
