# fix(web): the profile breadcrumb no longer wraps badly on a phone

Targets `main`. Layout only.

## What

Above a profile name sits "Teachers · Last updated 2 days ago". It was inline
text with a separator, so on a narrow screen it wrapped mid phrase and left the
middot dangling at the end of a line, which reads like a typo.

The two parts now stack on a phone and sit side by side from `sm`, and the
separator only exists when they are actually on one line. Shared by the teacher
and room profiles through a small `ProfileBreadcrumb`, so the two cannot drift.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass.
- Verified on a 375px viewport: the link and the freshness line sit on their own
  lines with no stray separator, and are back on one line at `sm`.

## Verification steps

Open a teacher or room profile on a phone width: the line above the name reads
cleanly across two lines.

## Follow-ups

None.
