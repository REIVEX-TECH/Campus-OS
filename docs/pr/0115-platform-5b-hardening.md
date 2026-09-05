# chore(platform): 5B hardening - loud cleanup log, journal parity, FORCE note

Three follow-ups from the Piece 2a review, folded into one small PR.

## What

1. **Loud, not silent, grant-cleanup failure.** `revokeSession`'s best-effort
   grant cleanup previously swallowed errors with an empty `catch` (a missing
   migration once hid there, caught only by a downstream test). It now logs a
   structured error (`event`, `pgCode`, `message`) so a broken cleanup is always
   visible. Still best-effort: it never re-throws, so it cannot fail the sign-out.
   No PII logged (pg code + message only).

2. **Journal-parity test closes the class.** New
   `apps/web/test/migration-journal-parity.test.ts` discovers every module's
   `drizzle/` folder and asserts each `.sql` has a matching `meta/_journal.json`
   entry and vice versa. A hand-authored migration with no journal entry (never
   applied) or a journal entry with no file now fails a fast unit test instead of
   silently in CI. Same approach as the pinned FORCE-state test: close the class,
   not the instance.

3. **`platform_tenant_grants` FORCE note.** The FORCE-state pin already lists
   `platform_tenant_grants`/`platform_grant_uses` as deliberately no-FORCE; the
   comment now spells out that the grant definers (incl. `0021`
   `auth_revoke_grants_for_session`) read AND write them as the owner, so flipping
   to FORCE in a hardening pass would filter every grant definer to nothing. A
   future pass sees the reason not to touch it, beside the pin.

## Data & migration impact

No schema change. No new migration.

## Tests

- `apps/web/test/migration-journal-parity.test.ts` (new, 5 cases): discovers >= 3
  migration folders; per folder asserts `.sql` <-> journal parity. Verified it
  passes for db/identity/communities/timetable and would have failed on the
  unregistered `0021`.
- Full web unit suite: 94 pass.

```bash
pnpm -C apps/web exec vitest run
```

## Verification steps

- `tsc --noEmit` (identity + web) and lint clean; web suite green.

## Follow-ups

- Timetable e2e deflake (wait for hydration / combobox ready state) queued after
  5B; it has cost several reruns.
- Continue 5B: Piece 2 (open/close grant UI + reason + countdown + preflight).
