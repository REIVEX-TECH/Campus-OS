# feat(identity): the identity data model and its isolation guarantees

Targets `main`. Identity PR 1 of the approved sequence. **Nothing user visible**:
no routes, no UI, no auth flow. The value is the schema, the policies, and tests
that prove the isolation holds.

## What

- **New package** `@campusos/module-identity` with `users`, `sessions`,
  `tenant_memberships`, `platform_roles`, `handle_history`, and `audit_log`.
- **A second RLS context.** The rest of the schema is tenant scoped and keyed by
  `app.tenant_id`, but a person exists above any one university, so most identity
  tables have no `tenant_id` to key on. `withActor` and `withActorInTenant` set a
  transaction local `app.user_id` alongside it, and the policies key on that.
  Same shape as tenants: transaction local so it is pool safe, and unset means no
  rows.
- **Policies**: own row for `users`, `sessions`, `platform_roles`, and
  `handle_history`; `tenant_memberships` answers both "which tenants am I in",
  before a tenant is chosen, and "who is in this tenant", inside a tenant
  context. `audit_log` is append only and readable within the tenant it touched,
  so a tenant admin can see who acted in their tenant.
- Only what Google gives us is stored: subject id and verified email. No display
  name, no photo.

## Two things found by building it

**Session resolution does not work as designed, and is deliberately not shipped.**
`auth_resolve_session` was to be a `SECURITY DEFINER` function, since resolving a
session happens before the user is known. It returns nothing: the application
connects as `campusos_app`, which is also the table owner, so `SECURITY DEFINER`
elevates to the calling role and gains nothing, and `FORCE ROW LEVEL SECURITY`
applies the policy to the owner too. Shipping a function that silently returns
nothing would be worse than shipping none, so it is left out and written up in
`docs/overnight/DECISIONS.md`. It needs a database role decision (recommended:
split the migration owner from the application role) and blocks identity PR 2.

**Modules were silently skipping each other's migrations.** Drizzle applies only
migrations dated after the last one recorded in its bookkeeping table, and every
module shared one. Adding identity, whose folder is dated later than timetable's,
made a fresh database record identity and then skip every timetable migration, so
`departments` was never created. Each module now names its own bookkeeping table
(`ModuleMigrations.table`), and identity uses one. Base and timetable keep the
default table untouched, so no existing database re-runs anything.

## Data & migration impact

Six new tables and their policies, in a new module migration folder with its own
bookkeeping table. Additive: nothing existing is altered, and no existing
migration is re-run. Rollback is dropping the new tables.

## Tests

- Integration (12 new): a user reads only their own row and cannot write a row
  claiming another identity; no actor context returns nothing at all; sessions are
  private to their owner; membership reads work in both contexts and never leak
  one tenant's members to another; platform roles are private; the audit log
  accepts appends, is visible inside the tenant it touched, and survives an
  attempted update and delete unchanged.
- All three integration suites now coexist on one database (identity 12,
  timetable 32, db 4), which is what caught the migration bug.
- `pnpm turbo run typecheck lint build test` (24 tasks) and
  `pnpm --filter web test:e2e` (33) pass.

## Verification steps

`pnpm -r test:integration` against a Postgres. The isolation suite is the
verification: it fails loudly if a policy is loosened.

## Follow-ups

- Session resolution, per `docs/overnight/DECISIONS.md`. Identity PR 2 waits on it.
- Any future module must declare its own `migrations.table`.
