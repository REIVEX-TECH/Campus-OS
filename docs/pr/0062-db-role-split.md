# feat(db): split the schema owner from the application role

Targets `main`. Ships the migration, the bootstrap changes, and a runbook.
**It does not touch production: the ownership change is run by hand on the VPS.**

## What

The application connected as `campusos_app`, which also owned every table. RLS
does not apply to a table's owner unless the table sets `FORCE`, so tenant
isolation rested on remembering `FORCE` on every future table rather than on the
application simply not being privileged. It also made `SECURITY DEFINER`
meaningless, which is why `auth_resolve_session` returned nothing: it elevated to
the role already calling it, and `FORCE` applied the policy to the owner anyway.

After this:

- `campusos_owner` owns the database, schema, and objects, and runs migrations.
- `campusos_app` owns nothing, so RLS applies to it structurally. It has
  `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and nothing else. In particular **no
  `TRUNCATE`**: `TRUNCATE` ignores RLS, so a runtime role holding it could empty
  every tenant in one statement.
- `auth_resolve_session` returns, owned by the schema owner, taking a hash rather
  than a token and returning at most one row on an exact match.
- `sessions` drops `FORCE`, which existed only because the application was the
  owner. The own-row policy is unchanged and still binds the application. `FORCE`
  stays on every tenant-scoped table as a safety net if anyone ever points the
  application at the owner credential.

`scripts/db-grants.sql` is the single definition of what the application role may
do, included by the development, CI, and production paths so all three agree.

## Two bugs fixed on the way

- **The identity module was never registered with the migration runner.** Its
  tables have never been created in production. `migrate-all` now includes it,
  and passes each module's own bookkeeping table.
- Integration suites reset state with `TRUNCATE`, which the application role must
  not have. They now use `runAsMigrationRole`, so the tests exercise the same
  privileges production uses instead of quietly requiring more.

## Data & migration impact

The ownership change is **manual and reversible**: see `docs/db-role-split.md`,
which includes the exact commands, verification, and a rollback that hands
ownership back. No data is moved or rewritten. The one automated migration
(`0002_session_resolve`) drops `FORCE` on `sessions` and creates the function.

## Tests

- Integration (3 new): the resolve function returns a live session with no actor
  context and nothing for an unknown, expired, or revoked token, and the
  application still cannot read `sessions` directly.
- The identity suite now asserts the split as a precondition and fails with an
  actionable message on a database that has not been split, because those
  guarantees would otherwise pass vacuously.
- `pnpm turbo run typecheck lint build test` (24 tasks) passes. The db and
  timetable integration suites pass locally against an un-split database, which
  exercises the `MIGRATION_DATABASE_URL` fallback.
- **The split itself is verified by CI**, which has a superuser, builds a fresh
  database from the shipped bootstrap, and runs every suite against it. It could
  not be verified on this machine: the local Postgres has no superuser available,
  so the owner role cannot be created here.

## Verification steps

CI is the verification. On the VPS, `docs/db-role-split.md` step 5 checks that
the application owns nothing, cannot `CREATE` or `TRUNCATE`, can still read, and
that `auth_resolve_session` is `SECURITY DEFINER` owned by `campusos_owner` and
callable by the application.

## Follow-ups

- Identity PR 2 (sign in and sessions) depends on this being run on the VPS.
