# fix(communities): take the karma rebuild away from the application role

## What

`communities_karma_recompute` was executable by the application role. Its own
comment in `0006_karma.sql` said it was not. This revokes it and holds the
revocation with a test.

## Why

Found while reviewing Phase 5, which turns on exactly this question: what a
SECURITY DEFINER function is reachable by.

`scripts/db-grants.sql:35-36` ends with

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO campusos_app;
```

so every function the owner creates is EXECUTE-granted to the application at
creation. Saying nothing grants it. The repository's usual
`REVOKE ALL ON FUNCTION ... FROM PUBLIC` does not undo it: that removes the
PUBLIC entry and leaves `campusos_app=X/campusos_owner` standing.

For every other definer in this repository that is the intended state — the
application is what calls them, and each does its own checks inside. This one
is different. It deletes and rebuilds a tenant's karma, and it reads every
author, anonymous ones included. It was documented as owner-only and was not.

**What was actually reachable.** Anything holding the application credential
could call `communities_karma_recompute('<tenant>')` and rewrite that tenant's
karma. It returns a count, not rows, so nothing was exposed by it; the cost was
integrity and the false claim in the comment.

## How

`packages/modules/communities/drizzle/0010_karma_recompute_grant.sql` revokes
by name, guarded on the role existing so an unsplit development database is
unaffected. The comment records the general rule, because Phase 5 adds definers
where the same mistake would matter far more.

## Tests

One new invariant, split-database only, beside the FORCE invariants it belongs
with: the application role calling `communities_karma_recompute` is refused with
`permission denied`. It is `skipIf(!split)` like the column-privilege test above
it, because an unsplit database has the application owning every function.

`pnpm turbo run typecheck lint test`: 26 tasks green.
`pnpm --filter @campusos/module-communities test:integration`: 44 passed, 2
skipped (both split-only).

## Verification steps

On a split database, as the application role:
`select communities_karma_recompute('lgu');` must fail with `permission denied
for function communities_karma_recompute`. As the owner it must still work, and
`pnpm communities:karma -- --tenant lgu` still connects as the owner.

## Migration notes

`packages/modules/communities/drizzle/0010_karma_recompute_grant.sql`, applied
by `pnpm db:migrate:all`. One REVOKE; no data touched. Rollback:
`GRANT EXECUTE ON FUNCTION communities_karma_recompute(text) TO campusos_app`,
which restores the defect. Your step on the live database.

## Breaking changes

None. Nothing in the application called it; the script connects as the owner.

## Follow-ups

- Worth a repository-wide pass at some point: every definer should state
  deliberately whether the application may call it, rather than inheriting an
  answer from the default privileges. This PR fixes the one function whose
  documented intent and actual grant disagreed.
