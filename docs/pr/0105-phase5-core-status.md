# docs: record the Phase 5 security core as merged

## What

The platform-admin status ledger, updated now that the Phase 5 security core and
the two pre-existing holes its review exposed have landed.

## Changes

- `docs/platform-admin-status.md`: Phase 5 row marked reviewed; a sub-phase table
  with 5A0 (`10110e5`), universities RLS (`b8ba354`) and 5A (`4f04509`); the next
  PR (membership/role writes behind a definer) and 5B/5G noted; the pointer to the
  5A definer SQL awaiting review before the UI phases.

## Data & migration impact

No schema change.

## Tests

None; documentation only.

## Verification steps

Read `docs/platform-admin-status.md` against `git log --oneline main`.

## Follow-ups

None.
