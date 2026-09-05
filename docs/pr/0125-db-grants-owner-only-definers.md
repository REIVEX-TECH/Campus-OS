# fix(db): stop db-grants re-runs from re-opening owner-only definers

`scripts/db-grants.sql` ended with `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA
public TO campusos_app`. On a fresh bootstrap that is harmless — it runs before
any function exists. But the file bills itself "idempotent: safe to re-run," and
the production role-split runbook (`docs/db-role-split.md`) includes it **after**
the schema exists. Run then, the blanket grant re-grants EXECUTE by name to
`campusos_app` on every owner-only `SECURITY DEFINER` function —
`communities_karma_recompute`, `auth_attach_role_internal`,
`audit_log_stamp_grant`, `auth_migrate_configured_admin` — and nothing revokes
them again, silently re-opening exactly the privilege holes those migrations
close (§8). Found by the §6 review of the karma-recompute fix (#138).

## The fix

Grant EXECUTE here on **non-`SECURITY DEFINER`** functions only. This is safe
because every app-callable definer already grants itself to `campusos_app` in its
own migration — verified: 27 app-callable definers in the `DEFINER_INTENT` map,
27 explicit `GRANT EXECUTE ... TO campusos_app` statements across the migrations,
an exact match. So on a re-run:

- app-callable definers keep EXECUTE (from their own migrations, persisted);
- owner-only definers stay locked (never granted here, revoked in their
  migrations);
- plain functions are still granted, as before.

The `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS` line is untouched:
it grants app EXECUTE on _future_ functions at creation, which is the accepted
grant-at-creation / revoke-in-migration pattern each owner-only definer relies on.
Only the blanket grant on _existing_ functions was the hazard.

The now-live `DEFINER_INTENT` guard keeps this honest in both directions: a
future app-callable definer that forgets its explicit grant would show
`app_can_execute=false` and fail the guard, so narrowing this grant cannot
silently strand an app function.

The loop also skips procedures (`prokind IN ('f','w')`): `GRANT EXECUTE ON
FUNCTION` errors on a procedure (which needs `ON PROCEDURE`/`ON ROUTINE`), and
under `ON_ERROR_STOP` that would abort the file — the old `ON ALL FUNCTIONS`
skipped procedures, so this matches it.

## Regression guard (in the split integration suite)

A blanket re-grant can only be caught where it actually happens — against a
database whose functions already exist. `db:migrate:all` migrates only
`campusos_dev` (all modules, timetable included); the communities suite migrates
`campusos_test` in its own `beforeAll` (base + identity + communities only), and
its `DEFINER_INTENT` guard reads `campusos_test`. A CI step that re-applied
db-grants before `test:integration` would hit an empty `campusos_test` (a no-op)
or, if forced to migrate it first, would drag timetable definers into a DB the
map does not cover. So the guard lives in the suite instead:

`communities.integration.test.ts` gains a test that re-applies db-grants'
function-grant loop (read from the real file) to the already-migrated
`campusos_test` as the owner, then asserts every definer's app EXECUTE still
matches its declared intent — and statically asserts the file never contains a
blanket `GRANT EXECUTE ON ALL FUNCTIONS ... campusos_app`. A revert to the
blanket grant fails it.

## Data & migration impact

No schema change, no migration. Changes a bootstrap/ops script and adds a test.
Idempotent; the fresh-bootstrap end state is unchanged (the loop is a no-op when
no functions exist yet).

## Tests

```bash
pnpm -C packages/modules/communities test:integration
```

The new test proves db-grants is genuinely re-run safe: re-applying its function
grant to a migrated database leaves no owner-only definer app-executable.

## Follow-ups

- None. The blanket-grant hazard is closed for all four owner-only definers and
  guarded against regression in the split suite.
