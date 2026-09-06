# fix(identity): key auth_write_standing self-check on the grant row

`auth_write_standing`'s "not yourself" check compared the target to `app.user_id`,
a GUC the application sets and can re-set mid-transaction. That is the exact shape
CLAUDE.md §8 forbids: an authorization decision keyed on an app-writable value is
not an authorization decision. Its siblings `auth_set_membership_role` and
`auth_verify_member` already refuse targeting the grant admin read from the
unforgeable txid-stamped use row (`auth_grant_admin_for_txn`); standing now does
the same.

Not exploitable today (standing only UPDATEs an existing membership, and a
platform admin under a grant holds none in the tenant, so a self-target returns
`not_found`) — fixed regardless of exploitability, because the rule is the point.

## Change

`packages/modules/identity/drizzle/0022_standing_self_check.sql` (+ journal entry):
`CREATE OR REPLACE FUNCTION auth_write_standing` splitting the single self-check
into two:

- grant path: `v_grant_admin := auth_grant_admin_for_txn()`; refuse when
  `p_target = v_grant_admin` (unforgeable; immune to a re-set `app.user_id`).
- member path: no use row, so refuse `p_target = app.user_id` as before.

Everything else (the restrict-members check, last-active-admin guard, the UPDATE,
the audit insert) is byte-identical. `CREATE OR REPLACE` preserves the 0019
EXECUTE grant; no schema change, no new ACL.

## Security review

Adversarial concrete-SQL pass per CLAUDE.md §6: **sound, no exploitable finding.**
The grant guard reads only the use row (never `app.user_id`); the two guards
partition on `v_grant_admin IS NULL` so exactly one is active and neither is
skippable; `auth_grant_admin_for_txn()` is non-null only for a transaction that
called `auth_assume_tenant_grant`, so an ordinary member write is unaffected (no
false positive); ACL and search_path unchanged; journal order keeps 0019 before 0022.

## Data & migration impact

Migration `0022_standing_self_check.sql` (identity). `CREATE OR REPLACE` of one
function; no schema/data change. Rollback: re-apply the 0019 body.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` (CI, split PG):
forges `app.user_id` to a third party mid-transaction, targets the grant admin,
and asserts `auth_write_standing` still returns `'self'` — passes only with this
fix (under 0019 it fell through to `'not_allowed'`).

```bash
pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` and the journal-parity test pass; the integration assertion runs
  in CI.

## Follow-ups

- Piece 3 (typed `/admin?grant=expired` redirect + 10s `statement_timeout`) and
  Piece 4 (tenant transparency panel).
