# feat(platform): 5B piece 2a - ending a session revokes its grant

## What

A platform grant is bound to a `session_id`. `auth_assume_tenant_grant` (0018)
already refuses a grant whose session is revoked or expired, so a grant is
UNUSABLE the instant its session ends. But `auth_open_tenant_grant`'s "one open
grant per admin" guard keys on the grant's own `revoked_at`/`expires_at`, not on
session liveness, so after sign-out the unusable grant still reads as open and
blocks the admin's next Enter until it expires (up to 30 min).

This closes that gap so ending a session actually ends the grant:

- `packages/modules/identity/drizzle/0021_grant_session_end.sql` - new
  `SECURITY DEFINER auth_revoke_grants_for_session(uuid)` that revokes every open
  grant bound to a session (sets `revoked_at`, `revoke_reason = 'session_ended'`,
  audits each). App-callable by name (sign-out runs as the app role); ambient
  PUBLIC/default grant revoked first.
- `packages/modules/identity/src/sessions.ts` - `revokeSession` (sign-out)
  revokes the session first (committed), then calls it best-effort, so sign-out,
  session revocation, and any future session-kill path revoke the bound grant.

Result across the three session-end paths:

- **Sign-out / revocation** (soft): grant revoked here, and unusable regardless
  via `auth_assume_tenant_grant`'s session join.
- **Expiry**: grant is unusable via the same join; `auth_open_tenant_grant`
  already auto-revokes the admin's expired grants on the next open.
- **Hard delete** of a session: `session_id … ON DELETE CASCADE` removes the grant.

## Security (adversarial concrete-SQL pass, per CLAUDE.md §6)

- The function is a DENIAL/cleanup: it only sets `revoked_at`; it grants no
  access and cannot escalate. The §8 forgeable-GUC rule concerns PRIVILEGE
  decisions; closing a grant confers nothing.
- Still scoped: it revokes only grants for a session whose owner
  (`sessions.user_id`, unforgeable by the app) equals `app.user_id`; another
  user's `session_id` matches nothing.
- No FORCE on `platform_tenant_grants`, so the owner-run definer's UPDATE is not
  silently filtered (same as `auth_revoke_tenant_grant`).
- The `audit_log` insert mirrors `auth_revoke_tenant_grant` (append policy
  `WITH CHECK (true)`, `admin_tenant_session_id` nullable); the
  `audit_log_stamp_grant` trigger leaves it NULL outside a granted transaction,
  as it already does for that sibling. The `close_only` BEFORE UPDATE trigger
  permits exactly the three columns this UPDATE touches.

The adversarial pass returned no exploitable findings and one robustness note,
now addressed: `revokeSession` revokes the session FIRST (its own committed
transaction), then runs the grant cleanup best-effort (swallowed), so a cleanup
failure can never abort the sign-out and leave the token live. The grant stays
unusable regardless via the session-liveness join, so the swallow is safe.

## Data & migration impact

Migration `0021_grant_session_end.sql` (identity module). Additive: one new
function + one grant. Backwards compatible; no data change. Rollback:
`DROP FUNCTION auth_revoke_grants_for_session(uuid)` and revert `revokeSession`.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` (CI, split PG):
"signing out revokes the grant, so a fresh session opens cleanly (0021)" -
opens a grant, signs out, asserts re-entry raises `no open tenant grant`, then a
fresh session for the same admin opens a new grant with no lingering `55006`.

```bash
pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` and identity unit tests pass; the integration assertion runs in CI.

## Follow-ups

- Piece 2 (open/close UI + reason + countdown + preflight), then 3 (typed
  redirect + statement_timeout), then 4 (tenant transparency).
