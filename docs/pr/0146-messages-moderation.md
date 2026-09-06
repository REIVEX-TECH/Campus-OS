# feat(messages): moderation for direct messages (§6, §8)

Block 3, second PR (stacked on the module core). Reporting a message, a moderator
queue that reads a snapshot, and message removal — the CLAUDE.md §8 baseline that
must ship with a user-to-user feature. Adds a privilege grant and two SECURITY
DEFINERs, so §6 (concrete SQL) applies.

## The shape of the problem

A message is private to its two participants (0000), so a moderator is **not** a
participant and cannot read the live thread. Reporting therefore captures a
**snapshot** of the reported message and the few around it, taken in the
reporter's own context (they can read their own conversation), and that snapshot
is what a moderator reads. The UI will say so: "Reporting saves a copy for
moderators."

## What (migration 0001)

- **`msg_reports`**: a report on a message, with the captured `snapshot` (jsonb:
  the reported message + up to five before and after). Own-insert / own-read RLS
  for the reporter (keyed on `app.user_id`), **NOT forced**, so the definers below
  read and resolve across reporters while the app role stays confined. One report
  per reporter per message.
- **`messages.moderate`** added to the core catalogue, the manifest, and the
  `tenant_admin` role template (backfilled onto existing roles) — the lost-found
  0002 pattern.
- Two `SECURITY DEFINER` functions, both gated on `messages.moderate` via
  `auth_effective_permissions` (empty / 0 otherwise): `auth_msg_report_queue`
  (open reports + snapshot + reporter handle) and `auth_msg_resolve_reports`
  (resolve a message's open reports; on `removed`, tombstone the message across the
  participants; audited as `message.moderated`).
- **`moderation.ts`**: `reportMessage` (captures the snapshot, one per reporter,
  a per-hour cap), `moderationQueue`, `resolveReports`, `canModerate`.

## §6 (concrete SQL)

- Both definers require `messages.moderate` before returning anything; a
  non-moderator gets an empty queue and a 0 resolve. `msg_reports` own-row RLS
  keeps a member from reading others' reports; NOT forced is what lets the
  owner-run definers see across, documented in the migration.
- The removal write (`auth_msg_resolve_reports` on `removed`) tombstones the
  message as the owner (msg_messages is NO FORCE); it never touches a message
  outside the named tenant.
- Both definers are app-callable and self-gating, declared `app` in the global
  DEFINER_INTENT registry; the communities registry suite now applies the
  messages migrations by path so it sees them deterministically (the L&F pattern).

## Moderation reads only the snapshot

A moderator is not a participant, so `auth_msg_report_queue` returns the captured
snapshot, never the live thread — the report is the only cross-participant window,
and it exists because the reporter chose to open it.

## Data & migration impact

Module migration `0001_messages_moderation` (journal idx 1): one table, the
permission grant + backfill, two definers. Backwards-compatible; applies cleanly
(verified locally against the dev DB up to the split check).

## Tests

`messages.integration.test.ts` gains a moderation suite (split DB): a participant
reports a message and the snapshot carries the words and the surrounding context;
a non-moderator (either participant) sees an empty queue; a moderator sees the
report though they are not a participant; a non-moderator cannot resolve; a
moderator removes (the message becomes a tombstone) and the queue clears; a report
on a message the reporter cannot see is refused.

```bash
pnpm -C packages/modules/messages test:integration
```

## Follow-ups

UI (inbox/thread + a report control), delete-for-me + ephemerality + cleanup
cron, blocks honored both ways (composed at the route), and enable for LGU — the
release completes when moderation (this PR) and blocks are both in before the
tenant is switched on (§8).
