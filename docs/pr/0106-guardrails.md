# chore: forbid direct commits to main, and record the RLS authorization rule

Two guardrails from the Phase 5 review.

## What

- `.husky/pre-commit` refuses a commit made on `main`, with a message pointing
  to `git switch -c`. Verified: committing on `main` now exits non-zero before
  lint-staged runs.
- `CLAUDE.md` §8 gains the standing rule that an authorization decision keyed on
  an application-writable value (`app.user_id`, `app.tenant_id`, any GUC) is not
  an authorization decision — privilege decisions must key on a row the app
  cannot forge — plus the companion rule about revoking writes by name and
  routing through a definer.
- `CLAUDE.md` §6 records that security SQL is reviewed against the concrete SQL,
  not the design, because two Phase 5 escalations passed design review and died
  only on implementation review.

## Why

I committed to local `main` once during Phase 5 and had to unpick it onto a
branch by hand; the hook makes that unrepeatable at the source. And the
double-break lesson belongs where it constrains every future module, not only
in agent memory.

## Data & migration impact

No schema change.

## Tests

The hook is verified by observation (a commit on `main` is refused). No unit
test; a hook cannot easily be exercised in CI without committing.

## Verification steps

On `main`, `git commit` on any staged change is refused with the guard message.
On a branch it proceeds as before (lint-staged runs).

## Follow-ups

- Server-side branch protection on `main` (require PRs, no direct pushes) is a
  GitHub repo setting and complements the local hook; enable it in repo settings.
