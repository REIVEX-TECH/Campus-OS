# fix(communities): run the integration guards that skipIf silently disabled

Three `it.skipIf(!split)(...)` tests in the communities integration suite have
never run. `split` is `let split = false` set to `true` only inside `beforeAll`,
but Vitest evaluates the `skipIf` argument at **collection** time — before any
`beforeAll` — so `!split` is always `true` and each test registers as
permanently skipped. Proven with a minimal repro: a control `it` asserting
`split === true` at run time passes while its `it.skipIf(!split)` sibling is
skipped.

The three dormant guards are load-bearing:

- **`DEFINER_INTENT`** — the invariant that every public `SECURITY DEFINER`
  function is declared app- or owner-callable and that its actual EXECUTE grant
  matches. This is the 2b-hardening centerpiece CLAUDE.md §6/§8 leans on; a
  boundary enforced by a test that does not run is a convention, not a boundary.
- **karma rebuild beyond the application's reach** (RLS / owner-only definer).
- **the application role cannot read `author_id`** (RLS, anonymous authorship).

That the `DEFINER_INTENT` guard was off is why `auth_revoke_grants_for_session`
(identity 0021) and `auth_migrate_configured_admin` (identity 0023) reached main
undeclared without failing CI.

## Changes (`packages/modules/communities/test/communities.integration.test.ts`)

- Convert the three `it.skipIf(!split)(...)` tests to plain `it(...)` that skip at
  **run time** (`if (!split) return ctx.skip();`), after `beforeAll` has set
  `split`. Verified in Vitest 3.2.7 that a run-time-set flag then gates correctly.
- Declare the two definers the now-live `DEFINER_INTENT` guard would otherwise
  flag as undeclared: `auth_revoke_grants_for_session: 'app'` (identity 0021
  grants EXECUTE to `campusos_app`; called from the sign-out path) — and
  `auth_migrate_configured_admin: 'owner'` was already added with 0023.

The full set of public `SECURITY DEFINER` functions the guard's database
contains (base + identity + communities) was enumerated and matched against the
map: 31 functions, 31 entries, no undeclared and none stale. The guard now
actually checks each one's EXECUTE grant against its declared intent.

## Data & migration impact

No schema change. Test-only.

## Tests

The change is to the integration suite itself. These guards run against a split
Postgres in CI (they self-skip on an unsplit database, now correctly at run
time):

```bash
pnpm -C packages/modules/communities test:integration
```

CI green here now means the three guards genuinely executed — in particular that
every public definer's EXECUTE grant matches its declared owner/app intent.

## Follow-ups

- If the now-live `DEFINER_INTENT` guard ever reports a _mismatch_ (an actual
  grant contradicting the declared intent), that is a real privilege finding to
  fix at the SQL, not a declaration to adjust.
