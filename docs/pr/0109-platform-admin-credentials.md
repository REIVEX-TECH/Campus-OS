# feat(5G): platform-admin credential runbook + a structural definer-grant guard

Phase 5G, the recovery procedure for the credential that controls cross-tenant
administration, plus the class-covering test the twice-bitten EXECUTE trap earned.

## What

- `docs/runbooks/platform-admin-credentials.md`: how to change
  `SUPERADMIN_EMAILS`, how to actually revoke a super admin (de-list is not
  enough), how to recover from a lockout cold via the owner connection, and how
  to verify access before ending the session.
- `packages/modules/identity/drizzle/0020_definer_grant_hygiene.sql`: revokes the
  last owner-only definer (`audit_log_stamp_grant`, a trigger function) that was
  still inheriting the application's EXECUTE grant.
- A new invariant test asserting **every** SECURITY DEFINER's actual EXECUTE
  grant matches its declared intent.

## Why the guard test

The `REVOKE ... FROM PUBLIC` trap bit twice — `communities_karma_recompute`
(PR #113) and `auth_attach_role_internal` (caught in 0019's review). Pinning the
known offenders does not cover the idiom. The test enumerates every
`prosecdef` function in `public` and checks `has_function_privilege('campusos_app',
…, 'execute')` against a declared `DEFINER_INTENT` map (`app` vs `owner`). It
fails three ways by construction:

- a new definer that is not in the map (forces a deliberate `app`/`owner` choice);
- an `owner` definer that is app-executable (the inherited-grant trap);
- an `app` definer nobody granted.

So a future owner-only definer that silently inherits the app grant fails CI
rather than waiting for an adversarial read. The audit turned up exactly one
function still on the wrong side — `audit_log_stamp_grant` — which 0020 revokes;
a trigger fires regardless of the invoker's EXECUTE privilege, so this removes a
direct-call surface and changes nothing about the stamp.

## The runbook, in brief

- **Change `SUPERADMIN_EMAILS`:** edit `.env` → `set -a; . ./.env; set +a; pm2
restart campusos --update-env && pm2 save` → the listed person signs in →
  verify. The list does not take effect until the restart; sessions and existing
  `platform_roles` rows are untouched.
- **Remove a super admin:** de-list AND delete the row — promotion is upgrade
  only, so removing the address alone leaves them an admin. Exact owner-connection
  SQL included.
- **Lockout recovery:** cold owner-`psql` via `MIGRATION_DATABASE_URL`: find your
  `users` row, check `platform_roles` and the running env, and restore access
  with a direct `INSERT INTO platform_roles ... ON CONFLICT DO NOTHING` (the owner
  may write it since 0016 dropped FORCE; the app cannot).
- **Verify before ending the session:** an owner-`psql` query listing every
  platform admin, plus opening `/admin`, so a lockout is never discovered later.

Written for you to execute; nothing here was run against production.

## Tests

- New split-only invariant (identity isolation suite): every definer's EXECUTE
  grant matches `DEFINER_INTENT` (26 `app`, 3 `owner`), and no definer is
  undeclared or stale.
- `pnpm turbo run typecheck lint test`: 26 tasks green; communities integration
  44 passed locally. The invariant and the 0020 revoke bind on the split
  database, so CI is where they are enforced.

## Migration notes

`packages/modules/identity/drizzle/0020_definer_grant_hygiene.sql`, applied by
`pnpm db:migrate:all`. One split-guarded REVOKE; no data. Rollback:
`GRANT EXECUTE ON FUNCTION audit_log_stamp_grant() TO campusos_app` (restores the
inherited grant). Your step on the live database.

## Follow-ups

5B — the platform-admin surfaces under granted transactions — is the remaining
Phase 5 work.
