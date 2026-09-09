# feat(rides): safety — reports, moderation queue, threshold hide

Block B, PR 4. Reporting a ride or a person, an auto-hide at the report threshold,
and a moderator queue + removal — mirroring Lost & Found moderation (0002). Stacked
on PR 3.

## What

- **`ride_reports` (migration `0003`)** — `target_type` (`ride_post` | `user`),
  `target_id`, `reporter_id`, `reason`, `note`, `status`, `resolution`. Own-insert /
  own-read RLS, NO FORCE (the queue/resolve definers read across reporters as owner);
  one report per reporter per target.
- **`ride_posts` gains** `removed_at` / `removed_by` / `removal_reason` (moderator
  removal) and `hidden_at` (auto-hide). Browse now excludes hidden and removed rides
  (a hidden ride keeps its `active` status, so status alone would not filter it).
- **`rides.moderate`** granted to the `tenant_admin` template and backfilled onto the
  materialised roles.
- **Two definers** — `auth_rides_report_queue` and `auth_rides_resolve_reports` —
  each self-gates on `rides.moderate` via `auth_effective_permissions` (so a resident
  admin or a platform admin under a live grant qualifies; anyone else gets an empty
  queue / a no-op), the L&F moderator-definer pattern.
- **`safety.ts`** — `reportTarget` (idempotent; a ride reaching `reportThreshold`
  open reports auto-hides pending a moderator), `moderationQueue`, `dismissReports`
  (un-hides), `removeRide` (moderator-only, resolves the reports).

## Data & migration impact

New table `ride_reports`, four columns on `ride_posts`, two definers, one permission
grant + backfill (migration `0003`, rides module). Additive. Rollback = drop the
table/columns/functions and the permission rows. Nothing enabled for any tenant.

## Security review (CLAUDE.md 6, 8)

- Reports are own-row (own-insert / own-read); moderators read and resolve only
  through the two definers, each gated on `rides.moderate` through
  `auth_effective_permissions` — a permission read that already keys the grant branch
  on the unforgeable txid use-row (0018/0032). No privilege decision rests on a GUC.
- The two definers are `REVOKE ALL FROM PUBLIC` then granted to the app, declared
  `'app'` in the communities DEFINER_INTENT audit.
- Auto-hide and moderator removal are ordinary in-tenant updates (the posts pattern);
  removal additionally requires the permission (`canModerate`), so a non-moderator is
  refused (`not_allowed`).

## Tests

`test/rides-safety.integration.test.ts` (real Postgres, split-DB only): a ride
auto-hides at the threshold and appears in the moderator queue (empty for a
non-moderator); a moderator removes a ride (a non-moderator is refused) and its
reports resolve; dismissing un-hides; a report against a person is queued. All rides
integration tests green locally. Module typecheck + lint pass.

## Follow-ups

Per `docs/design-rides.md`: the signed **share-link** (`ride_share_tokens` + a public
read-only trip page) is deferred to the safety UI PR (it needs a public web route).
PR 5 lifecycle (sweep, auto-complete, recurrence) remains. The moderation UI rides on
this layer.
