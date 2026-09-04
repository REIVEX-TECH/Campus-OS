# docs: record the membership-writes definer as merged

## What

`docs/platform-admin-status.md`: the membership/role-writes-behind-a-definer step
is marked merged (`3c95d11`) with a note that its adversarial pass caught a
repeat of PR #113's REVOKE-FROM-PUBLIC trap and the one missing grant guard,
both fixed before merge.

## Data & migration impact

No schema change.

## Tests

None; documentation only.

## Verification steps

Read `docs/platform-admin-status.md` against `git log --oneline main`.

## Follow-ups

5B (surfaces under granted transactions) and 5G (the SUPERADMIN_EMAILS runbook)
remain.
