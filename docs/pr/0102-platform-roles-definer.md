# feat(identity): platform_roles is written only by a definer, never by the app

Phase 5A0. The foundation cross-tenant administration is about to be built on:
a `platform_admin` row must not be something the account that holds it can write
itself.

## What

- `platform_roles` is no longer writable by the application role. The row policy
  becomes SELECT-only; there is no INSERT/UPDATE/DELETE policy, so under RLS the
  app cannot write the table by any statement.
- `auth_grant_platform_admin(text[])`, a SECURITY DEFINER, is the one writer. It
  promotes the **caller** — the email is read from `users` by `app.user_id`, not
  taken as an argument — and only if that email is on the allowlist it is
  handed, and it writes the audit line in the same statement.
- `ensurePlatformAdmin` calls the definer instead of inserting the row.
- `parseEmailList` now requires a real address, not any string containing `@`.

## Why

The review of Phase 5 found that `own_platform_role` was `FOR ALL` with
`user_id = current_setting('app.user_id')`, so the **database itself permitted
any signed-in request to insert its own `platform_admin` row**. Nothing in the
application does that — the only writer checked the allowlist first — but the
database did not know that, and a future code path or an injected INSERT would
have been waved through. God-mode cannot sit on a table its holder can write
itself into.

## How

### Migration, `packages/modules/identity/drizzle/0016_platform_roles_definer.sql`

- `platform_roles` loses FORCE. This is the repository's standard resolution of
  the FORCE trap: FORCE makes the row policies bind the table's owner too, and
  the definer runs as the owner and must INSERT; with no INSERT policy a FORCEd
  owner is denied its own write. Dropping FORCE lets the owner (the definer)
  write it while the application, a **non-owner**, stays bound by the SELECT-only
  policy — exactly how `users`, `sessions`, `roles` and every other
  definer-touched table already work. The invariant test's FORCE map is updated
  with the reason.
- `own_platform_role` (FOR ALL) is replaced by `own_platform_role_read` (SELECT).
- `auth_grant_platform_admin` validates each allowlist entry against a real-email
  pattern too, so a stray `@` that reached the list cannot match an account, and
  compares whole addresses case-insensitively. `ON CONFLICT DO NOTHING` keeps it
  idempotent; it returns true only when a row was actually written.
- `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE ... TO campusos_app` by name.
  The application calls it at sign in; the grant is deliberate and explicit,
  which is the lesson from PR #113 — a definer's reachability must be stated, not
  inherited from the owner's default privileges.

### The two conditions this PR carries

- **Hole (a), closed and confirmed.** A direct `insert into platform_roles` as
  the application role now fails; the test asserts it. The residual is narrow and
  named in Follow-ups.
- **Condition 3, fail-closed.** An empty or unset `SUPERADMIN_EMAILS` yields an
  empty allowlist; `isAllowlisted` is false for everyone and the definer refuses
  an empty list, so no one is promoted and there is no first-user fallback. Both
  layers are tested.

## Security

The env stays the master key: `SUPERADMIN_EMAILS` names who may be promoted, a
`platform_roles` row records who is. What moved is that the promotion, the
allowlist check and the audit line are one indivisible act in the database
rather than a TypeScript check followed by a write the policy allowed.

The definer takes no "which user" argument and reads the target email from the
caller's own `users` row, so it can only ever promote the caller. Combined with
the SELECT-only policy, a signed-in request can no longer write itself a
platform-admin row by any raw statement.

## Tests

- Integration (identity isolation suite, CI-only, split database):
  - a direct `insert into platform_roles` by the app role is refused, and no row
    appears;
  - the definer refuses an empty allowlist, a junk `@` entry, and an address
    that is not the caller's; promotes the caller on their own address
    (case-insensitively); is idempotent; the row is visible only to the holder;
    and one `platform.admin_granted` audit line is written by the grant.
- Unit (`superadmins.test.ts`): `parseEmailList` rejects `@`, `foo@`, `@bar.com`
  and `foo@bar`, keeps real addresses, and is empty for unset/empty/whitespace —
  fail closed, no first-user fallback.
- Verified the definer end to end against the dev database by probe (empty →
  false, bad `@` → false, other's address → false, own address any case → true,
  again → false, one row, one audit line, FORCE off).
- `pnpm turbo run typecheck lint test`: 26 tasks green. `pnpm --filter web
test:e2e`: 86 passed. `pnpm --filter web build` clean. The identity
  integration suite is CI-only (needs the split database).

## Verification steps

Run the migration (below). On a split database, as the application role,
`insert into platform_roles (user_id, role) values (…, 'platform_admin')` must
fail. Sign in with an address in `SUPERADMIN_EMAILS` and confirm the row and one
`platform.admin_granted` audit line appear; sign in with an address not on the
list and confirm neither does. Unset `SUPERADMIN_EMAILS` and confirm a fresh
sign-in promotes no one.

## Migration notes

`packages/modules/identity/drizzle/0016_platform_roles_definer.sql`, applied by
`pnpm db:migrate:all`. Existing `platform_roles` rows are untouched, so no
current platform admin is affected — nobody is locked out by this. Rollback:
drop `auth_grant_platform_admin`, drop `own_platform_role_read`, recreate
`own_platform_role` FOR ALL, and `ALTER TABLE platform_roles FORCE ROW LEVEL
SECURITY` — which restores the hole. Your step on the live database.

## Breaking changes

None observable. `ensurePlatformAdmin` keeps its signature and behaviour: the
same addresses are promoted, existing rows are untouched.

## Follow-ups

- **Residual on hole (a).** A caller that holds the application database
  credential and calls `auth_grant_platform_admin` with a forged allowlist
  containing its own verified email can still promote itself. That is the
  app-credential trust boundary, identical to today's exposure through the
  sign-in route, and it cannot be closed while the allowlist is an environment
  variable the app process reads. Closing it fully means moving the allowlist
  into an owner-only table the app cannot write, seeded from the environment by
  an owner-run step — a change to the "env is the master key" model and a new
  lockout surface. Flagged for your decision rather than folded in; say the word
  and it is a small, self-contained PR.
- The platform `/login` page and its "refuses everyone when unset" e2e belong to
  the login phase; the fail-closed property is unit- and integration-tested here
  at the layer that decides it.
