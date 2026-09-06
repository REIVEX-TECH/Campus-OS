# feat(lost-found): reporting and moderation (§8 baseline)

Lost & Found PR 4b. Reporting an item or a claim, a moderator queue, and item
removal — the CLAUDE.md §8 baseline that must ship with the claim feature. With
this, the module is complete enough to enable (PR 5).

## What (migration 0002)

- **`lf_reports`**: a report on an `lf_item` or `lf_claim`. Own-insert / own-read
  RLS (reporter = `app.user_id`), NO FORCE so the moderator definers read and
  resolve across reporters; the app role stays confined. One open report per
  reporter per target.
- **`lostfound.moderate`** added to the enforced catalogue and granted to the
  `tenant_admin` role template, with a backfill of existing `tenant_admin` roles.
- Two `SECURITY DEFINER` functions, both gated on `lostfound.moderate` via
  `auth_effective_permissions` (empty / 0 otherwise): `auth_lf_report_queue`
  (open reports + enough of the target to triage, including a reported claim's
  message, which is otherwise participant-only) and `auth_lf_resolve_reports`
  (resolve a target's open reports, recorded with the moderator).
- **Module `moderation.ts`**: `reportTarget`, `moderationQueue`, `removeItem`
  (permission-checked update + resolves the item's reports), `dismissReports`.

## §6 (concrete SQL)

- The grant reaches only `tenant_admin`, materialised into `role_permissions`,
  read through the unforgeable membership/grant resolver — no GUC gates it.
- Both definers require `lostfound.moderate` before returning anything; a
  non-moderator gets an empty queue and a 0 resolve. `lf_reports` own-row RLS
  keeps a member from reading others' reports; NO FORCE is what lets the
  owner-run definers see across reporters, and is documented in the migration.
- `removeItem` re-checks `lostfound.moderate` in the transaction (the communities
  pattern); the item update rides the tenant policy.

## UI

- Report control (reason + optional note) on the item page and on each claim.
- `/u/[slug]/lost-found/mod` — the queue (remove item / dismiss), gated by
  `accessForPage('lostfound.moderate')`; a Moderation link shows on browse for
  holders of the permission.

## Known gap (logged)

Grant-based moderation (a platform admin under a grant) is not threaded through
the queue read, so it serves resident tenant admins; the page gate still applies.
Recorded in `docs/overnight/DECISIONS.md`.

## Data & migration impact

Module migration `0002` (own bookkeeping table): one table, two definers (both
app-callable, self-gating — no owner-only revoke needed), and the permission
grant + backfill. Journal `idx 2`.

## Tests

`lost-found.integration.test.ts` gains a moderation suite (split DB): a report is
invisible to a non-moderator's queue and visible to a moderator; a non-moderator
cannot remove; a moderator removes (item leaves browse) and the report resolves.

```bash
pnpm -C packages/modules/lost-found test:integration
```

Typecheck, lint verified locally; the suite runs in CI.

## Follow-ups

PR 5: enable Lost & Found for LGU (config change in the PR; flipped live after
deploy) + browse filter/search polish + the 90-day expiry job.
