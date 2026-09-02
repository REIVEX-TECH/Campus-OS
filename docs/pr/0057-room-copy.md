# fix(web): a room hosts courses, it does not teach them

Targets `main`. One string. No behaviour change.

## What

The room profile reused the teacher profile's "Courses taught" heading, which
reads wrong above a list of courses that happen in a lecture hall. Rooms now say
"Courses held here". The teacher heading is unchanged.

This was introduced when the room profile was built on the teacher one; the
shared components were the right call, the shared sentence was not.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass.

## Verification steps

Open any room: the card above its course list reads "Courses held here".

## Follow-ups

None.
