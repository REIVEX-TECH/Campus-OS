# feat(engagement): timetable chip signal engine and per-day dismissals

Run PR 2 (of the timetable-chips sequence). The deterministic signal engine (pure,
fixture-tested) and the per-user-per-day dismissal store. No UI, no telemetry. See
`docs/design-timetable-chips.md`.

## What

- `apps/web/lib/chips/signals.ts` — the pure engine: four signal functions
  (`marketplaceCourseMatch`, `lostfoundBuildingMatch`, `ridesAfterClass`,
  `freeWindowToday`) over already-fetched data, plus `chipsForStudent` which ranks
  (marketplace > lost-found > rides > free-window), drops dismissed kinds, and returns the
  single top candidate (or null when there are no classes today). No I/O, no clock of its
  own — `now`/timestamps are passed in.
- `packages/modules/identity/drizzle/0037_timetable_chip_dismissals.sql` + schema —
  `timetable_chip_dismissals(user_id, tenant_id, chip_kind, dismissed_on)`, own-row RLS
  (FORCE), written through the `record_timetable_chip_dismissal` `SECURITY DEFINER` which
  stamps user_id/tenant_id from the actor context and the day from the server clock.
- `packages/modules/identity/src/chips.ts` (new export `./chips`) — `dismissTimetableChip`
  (calls the definer) and `dismissedChipKindsToday` (own-row read scoped to today).

Data fetching (the live reads that feed the engine) and the chip UI land in PR 3; this PR
is the tested foundation.

## Data & migration impact

Identity migration `0037` adds one table (own-row RLS) and one definer. Additive; nothing
reads back differently. Rollback: drop the function and table.

## Security review (CLAUDE.md 6, 8)

- **The definer is a self-write, not an authorization decision**, so stamping the row's
  `user_id`/`tenant_id` from `app.user_id`/`app.tenant_id` is within the rule (§8): it
  grants no privilege and can only ever write the caller's own dismissal row. It also
  satisfies the own-row `WITH CHECK`, so it is no more powerful than a direct own-row
  insert; it just removes the chance for the app to supply another user's id. `RETURNS
void`, `ON CONFLICT DO NOTHING`, `search_path = public`, EXECUTE revoked from PUBLIC and
  granted only to `campusos_app`. It raises if there is no actor/tenant context and bounds
  `chip_kind` length.
- The table is ENABLE + FORCE RLS with a single own-row policy keyed on `app.user_id` for
  both read and write. No cross-tenant or cross-user read path exists.

## Tests / verification

`turbo run typecheck lint` passes for identity and web. The web vitest suite (incl. 16 new
`chips-signals` tests: each signal fires / does not fire / at its boundary, ranking, the
dismissed-fallthrough, and no-classes -> no chip) passes. An identity integration test
(split-only, in CI) proves the dismissal is per-day, own-row/private to the actor, records
through the definer, and that the definer cannot forge another user's row.

## Follow-ups (this run)

PR 3: live signal reads + the chip UI under the schedule (flag defaulted OFF). Deferred on
the missing `platform_events`/`is_platform`/`/admin/feed-cards` foundation: telemetry, the
feedback-onetime card, the admin panel, Block 2 (all with a proposed design in the design
doc).
