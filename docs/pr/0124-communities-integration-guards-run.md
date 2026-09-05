# fix(communities): revoke karma recompute from PUBLIC, and run the guards that caught it

Two linked changes: a live privilege fix, and the reason it went unnoticed.

## The hole

`communities_karma_recompute(text)` is owner-only by design — it deletes and
rebuilds a tenant's karma and reads every author, anonymous included; its only
caller (`recomputeKarma`) uses the owner connection. But it was reachable by the
application role in production:

- `0006` created it `SECURITY DEFINER` and never revoked `FROM PUBLIC`.
- `scripts/db-grants.sql` runs `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON
FUNCTIONS TO campusos_app`, so it was also granted to the app by name at
  creation.
- `0010` revoked only the by-name grant. The ambient **PUBLIC** EXECUTE stayed,
  so `has_function_privilege('campusos_app', …, 'execute')` remained **true** —
  the app role could invoke the rebuild.

The canonical owner-only pattern (`auth_attach_role_internal`, 0019) is _both_
revokes; `0010` did one. `0011` adds the missing `REVOKE … FROM PUBLIC` (and
re-asserts the by-name revoke), completing the lock.

## Why it was latent — the guards never ran

Three `it.skipIf(!split)(...)` tests in the communities integration suite have
never executed. `split` is `let split = false` set to `true` only inside
`beforeAll`, but Vitest evaluates the `skipIf` argument at **collection** time —
before any `beforeAll` — so `!split` is always `true` and each registers as
permanently skipped. Proven with a minimal repro: a control `it` asserting
`split === true` at run time passes while its `it.skipIf(!split)` sibling skips.

The dormant guards are load-bearing:

- **`DEFINER_INTENT`** — every public `SECURITY DEFINER` is declared app/owner
  and its actual EXECUTE grant matches. This is the guard that would have caught
  the karma hole (and it did, the moment it ran): `communities_karma_recompute:
intent=owner but app_can_execute=true`.
- **karma rebuild beyond the application's reach** — asserts the app is refused
  when it calls `communities_karma_recompute`.
- **the application role cannot read `author_id`** (anonymous authorship RLS).

A boundary enforced by a test that does not run is a convention, not a boundary.

## Changes

- `packages/modules/communities/drizzle/0011_karma_recompute_revoke_public.sql`
  (+ `meta/_journal.json` idx 11) — `REVOKE ALL ON FUNCTION
communities_karma_recompute(text) FROM PUBLIC` plus the split-guarded by-name
  revoke. Owner keeps EXECUTE by ownership; the one-time backfill in 0006 runs at
  migration time as the owner and is unaffected.
- `packages/modules/communities/test/communities.integration.test.ts` — convert
  the three `it.skipIf(!split)(...)` tests to run-time skips
  (`if (!split) return ctx.skip();`), so they actually run on a split database.
  Declare the two definers the now-live `DEFINER_INTENT` guard would otherwise
  flag as undeclared: `auth_revoke_grants_for_session: 'app'` (identity 0021) —
  `auth_migrate_configured_admin: 'owner'` was already added with 0023. The full
  public-definer set the guard's database contains (base + identity +
  communities) was enumerated against the map: 31 functions, 31 entries, none
  undeclared or stale.

## Data & migration impact

Migration `0011` (communities). Revokes a privilege only; no schema change,
backwards-compatible, no rollback needed (re-granting would reopen the hole).

## Tests

The activated guards ARE the verification: on a split Postgres, CI green here
means `communities_karma_recompute` is no longer app-executable and every public
definer's EXECUTE grant matches its declared intent.

```bash
pnpm -C packages/modules/communities test:integration
```

## Follow-ups

- If the now-live `DEFINER_INTENT` guard ever reports a _mismatch_, treat it as a
  real privilege finding to fix at the SQL, not a declaration to adjust — as here.
