# docs: record Phase C as merged

## What

The communities status ledger, brought up to date now that karma, participation
gates and reporting a person have all landed.

## Changes

- `docs/communities-status.md`: rows for C1, C2 and C3 with their merge commits;
  B6 and the design row corrected from "in review" to merged; the Phase C
  section says what shipped, including the follow-up that added the two
  addendum tests and fixed the standing-lapse bugs they found.

## Data & migration impact

No schema change.

## Tests

None; documentation only. `pnpm turbo run typecheck lint test` unaffected.

## Verification steps

Read `docs/communities-status.md` against `git log --oneline main`.

## Follow-ups

None.
