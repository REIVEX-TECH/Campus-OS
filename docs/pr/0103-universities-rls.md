# fix(identity): row-level security on universities, the table that had none

The second pre-existing hole the Phase 5 review found, closed. `universities` is
the parent every tenant hangs off, and it had no RLS at all.

## What

- `universities` gets RLS: public to read, platform-admin-only to write, no
  DELETE policy at all.
- `universitiesRepository.upsert` moves to the owner connection, because the
  application role can no longer write the table.
- The integration harnesses seed `universities` as the owner, as they already
  truncate it.

## Why

`universities` had no `ENABLE ROW LEVEL SECURITY` anywhere, and
`scripts/db-grants.sql` grants the application SELECT/INSERT/UPDATE/DELETE on
every table. Twenty-five foreign keys reference `universities(slug)` and every
one is `ON DELETE CASCADE`. So any code path in any tenant context — or none —
could rename, retime, or **delete** a university, and a delete would take every
community, post, comment, membership and audit row of that university with it.
Nothing in the application does this; the database simply allowed it. God-mode
is about to be built on top of tenant resolution, and the tenant table itself
was unguarded.

## How

### Migration, `packages/modules/identity/drizzle/0017_universities_rls.sql`

Modelled exactly on `tenant_configs` (0012), its sibling:

- `ENABLE ROW LEVEL SECURITY`, `NO FORCE`. FORCE is off because the SECURITY
  DEFINER functions that iterate every tenant — the karma rebuild, the
  role-template sync — read `universities` as the owner, and FORCE would filter
  the owner out and break them. The application is a non-owner in a split
  database, so the policies bind it regardless of FORCE.
- `universities_read` FOR SELECT USING (true): a slug and name are how the
  platform lists a university; the landing page already shows them all.
- `universities_platform_insert` / `universities_platform_update`: gated on
  `EXISTS (platform_roles … 'platform_admin')`, the same predicate
  `tenant_configs` uses. `createTenant` and `updateTenantConfig` run
  `withActorInTenant(<platform admin>, slug)`, so `app.user_id` is the admin and
  both writes are admitted; for anyone else they are refused at the row.
- No DELETE policy. DELETE is default-denied to the application role entirely,
  platform admin or not, because the cascade is catastrophic and tenant deletion
  is not a built feature. When it is, it will be a deliberate, audited act; until
  then a platform administrator who must remove a tenant does it as the owner by
  runbook. `tenant_configs` withholds DELETE the same way.

It lives in the identity module, not the base folder: it references
`platform_roles` (identity), the base folder is frozen (shared bookkeeping), and
identity already owns the matching `tenant_configs` policies.

### `universitiesRepository.upsert` → owner connection

The repository is used by the seed script and the tests, both of which hold the
application role. Since the app can no longer write `universities`, `upsert` now
runs through `withMigrationClient` (the owner). Writing a universities row is a
bootstrap act — the seed does it, and the tenant-CRUD path writes it as the
acting platform admin — not something a request does. `pnpm db:seed` is a
documented deploy step; verified it still works. Reads stay on the app pool
(public read).

### Test harnesses

Six integration suites seeded `universities` with `getDb().insert(...)` (the app
role). Under the new policy that fails in a split database, so each now seeds it
with `runAsMigrationRole` — the owner — exactly as they already truncate it.

## Tests

- `universities` has `relrowsecurity = true` and `relforcerowsecurity = false`
  (a new invariant).
- Extending the existing "refuses everyone who is not a platform admin" case: a
  non-platform-admin's direct INSERT into `universities` is refused at the row;
  an UPDATE matches no row and changes nothing; a DELETE removes nothing; the row
  is unchanged and no rogue row exists.
- The platform-admin path is already covered: `createTenant` writes the
  `universities` row and `updateTenantConfig` renames it (both assert the row).
- `pnpm turbo run typecheck lint test`: 26 tasks green.
  `pnpm --filter @campusos/module-communities test:integration`: 44 passed, 2
  skipped; timetable integration 39 passed; db integration 4 passed (all against
  the local unsplit database). The identity isolation suite, which carries the
  row-level refusal assertions, is CI-only (needs the split database).
  `pnpm --filter web test:e2e`: 86 passed. `pnpm db:seed` succeeds. Build clean.

## Verification steps

Run the migration (below). On a split database, as the application role,
`insert into universities …`, `update universities …` and `delete from
universities …` must write nothing (insert refused; update/delete match no row).
As a platform admin, create a tenant through the UI and confirm the university
row appears; rename it and confirm the change. `pnpm db:seed` must still succeed.

## Migration notes

`packages/modules/identity/drizzle/0017_universities_rls.sql`, applied by
`pnpm db:migrate:all`. It adds policies only; no data changes, no backfill, and
existing rows are untouched. Rollback: drop the four policies and
`ALTER TABLE universities NO FORCE` is already the state — `DISABLE ROW LEVEL
SECURITY` restores the prior (unguarded) behaviour. Your step on the live
database.

## Breaking changes

`universitiesRepository.upsert` now requires the owner connection
(`MIGRATION_DATABASE_URL`, or `DATABASE_URL` on an unsplit database), because
the application role may no longer write `universities`. Its signature is
unchanged. Nothing outside the seed and the tests calls it.

## Follow-ups

- Tenant deletion, when it is built, needs its own audited owner-run path
  (there is deliberately no DELETE policy).
- The broader default-EXECUTE observation from PR #113 and PR #114 still stands
  as a possible repository-wide pass; this PR and 5A0 fixed the two functions and
  the two tables where the gap actually mattered.
