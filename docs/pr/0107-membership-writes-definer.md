# fix(identity): membership and role writes leave the application's hands

The pre-existing hole the Phase 5 review named, closed. `tenant_memberships` and
`membership_roles` are no longer writable by the application role; every write
goes through a SECURITY DEFINER that checks the actor and audits.

## Why

`memberships_insert` (0008) and `membership_roles_in_tenant` (0010) authorised
writes by `tenant_id = app.tenant_id` alone — no check that the writer may write
a membership. So a bare foreign tenant context, via raw SQL as the app
credential, could self-insert a verified `tenant_admin` membership and its
`membership_roles` row, and `auth_effective_permissions` would resolve it as a
real administrator. The TypeScript callers checked authority first; the database
did not. That is the reasoning CLAUDE.md §8 now forbids, and the same shape 0016
fixed for `platform_roles`.

## How

`packages/modules/identity/drizzle/0019_membership_writes.sql`:

- Revokes INSERT/UPDATE/DELETE on both tables from `campusos_app` (split
  database only; on an unsplit dev database the app owns them and it is skipped).
- Routes every write through a definer that re-checks authority in the database
  and audits: `auth_join_as_student` (self student, the default-role floor),
  `auth_verify_self_by_domain` (self, email on the tenant's domain list),
  `auth_grant_configured_admin` (the 0016 pattern for config admins),
  `auth_verify_member` (an admin with `approve-verifications`),
  `auth_set_membership_role` (grant/revoke: `manage-roles`, no-power-above-your-
  own, last-admin, the platform exemption, and the not-yourself-under-a-grant
  containment), and `auth_write_standing` (restrict/suspend/reinstate).
- Drops the 5A RESTRICTIVE "no self under a grant" policies on these two tables:
  the app cannot write them at all now, so there is nothing for a RESTRICTIVE
  policy to narrow, and the definers enforce the containment in code.
- The rewired callers (`membership.ts`, `verification.ts`, `rbac.ts`,
  `standing.ts`) call the definers; where the database cannot know a tenant's
  domains or admin list (a file-configured tenant), the caller passes it and the
  definer checks the actor's OWN email against it — the same trust boundary as 0016.

## The adversarial pass caught two real bugs — including a repeat of PR #113

Per CLAUDE.md §6, the concrete SQL got an adversarial review, and it earned its
place: it found the migration had **repeated the exact trap PR #113 fixed and
this session wrote into CLAUDE.md**.

1. **Critical, fixed.** `auth_attach_role_internal` — an authority-free helper
   that writes any `membership_roles` row — was only `REVOKE ... FROM PUBLIC`,
   so the owner's default privileges left `campusos_app` holding EXECUTE in a
   split database: a direct, unaudited self-grant of `tenant_admin`, the very
   hole this migration exists to close. Now revoked from `campusos_app` by name,
   guarded so it does not fire on an unsplit database where the app is the owner
   and the internal definer callers depend on it.
2. **High, fixed.** `auth_verify_member` was the one membership-creating definer
   without the not-yourself-under-a-grant guard, so a platform admin under a
   grant could self-create a permanent verified membership. It now carries the
   same `auth_grant_admin_for_txn()` check as the others.
3. **Medium, fixed.** The guard test asserted the internal helper was uncallable
   but passed for the wrong reason (an FK error on a random id, not a permission
   error), which would have masked bug 1 in CI. It now asserts `permission
denied`.

The design-level plan was sound; both classes of bug lived only in the
implementation, which is exactly why the rule reviews the SQL as written.

## What this does NOT close (stated, not hidden)

`auth_verify_self_by_domain` and `auth_grant_configured_admin` check the actor's
own email against a list the caller passes. A fully compromised app credential
could pass a forged list and self-promote. That is the identical, accepted
trust boundary as `auth_grant_platform_admin` (0016) — for a file-configured
tenant the database does not hold the domains or admin list, so the caller must
supply them — and a compromised app credential is total tenant compromise
regardless. Where a tenant is database-configured, a later change could read the
list from `tenant_configs` inside the definer; noted as a follow-up.

## Tests

Split-database integration (CI-only):

- The application cannot write either table by any statement (insert, the
  `membership_roles` join insert, update), and `auth_attach_role_internal` is
  refused with `permission denied` — not an incidental FK error.
- Under a grant every self-promotion path is refused: the raw write, the
  `auth_set_membership_role` self-grant (`not_allowed`), and the
  `auth_verify_member` self-verify (raises).
- Every existing membership/verification/role/standing test still holds, with
  fixtures now seeded as the owner (`runAsMigrationRole`) since the app can no
  longer write them, and the changed return shapes (`decideRequest`,
  `verifyMember`) updated.

Locally (unsplit, where the definers run but the REVOKE does not bind):
communities integration 44 passed, timetable 39, db 4;
`pnpm --filter web test:e2e` 86 passed (real sign-in goes through the join and
verify definers); `pnpm turbo run typecheck lint test` 26 tasks green; build
clean.

## Verification steps

Run the migration. On a split database, as the application role, every direct
insert/update/delete on `tenant_memberships` and `membership_roles` is refused,
and `select auth_attach_role_internal(...)` is `permission denied`. Sign in on a
domain address and confirm a verified student membership; sign in off-domain and
confirm an unverified one; grant and revoke a role as a tenant admin; restrict
and reinstate a member — all still work, now through the definers.

## Migration notes

`packages/modules/identity/drizzle/0019_membership_writes.sql`, applied by
`pnpm db:migrate:all`. Additive: revokes, definers, and dropping two now-dead
RESTRICTIVE policies; no data changes. Rollback: recreate the four dropped
policies from 0018, drop the seven functions, and
`GRANT INSERT, UPDATE, DELETE ON tenant_memberships, membership_roles TO
campusos_app` — which restores the hole. Your step on the live database.

## Breaking changes

`grantVerified` and `attachRole` are removed from `@campusos/module-identity`
(internal; nothing outside this repo imported them). `decideRequest` returns
`{ outcome, decision }` and `verifyMember` returns `{ alreadyVerified }`; both
consumers in this repo are updated.

## Follow-ups

- 5B: platform-admin surfaces under granted transactions (unchanged from the 5A
  plan; this PR was the prerequisite the review demanded first).
- 5G: the `SUPERADMIN_EMAILS` + `platform_roles` rotation/recovery runbook,
  still owed.
- Optional hardening: for database-configured tenants, read the domain and admin
  lists inside `auth_verify_self_by_domain` / `auth_grant_configured_admin` from
  `tenant_configs` rather than from the caller.
