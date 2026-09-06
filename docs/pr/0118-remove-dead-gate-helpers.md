# chore(web): remove the dead permission-gate helpers

`currentPermissions`, `permitted`, `requirePermission` (and the `PermittedActor`
type) in `apps/web/lib/auth.ts` have no callers since Phase 5B routed every
tenant-admin surface through the tenant-access seam. A forbidden bypass primitive
that still exists is a convention, not a boundary, so they are deleted rather
than merely banned by the boundary test.

## Changes

- `apps/web/lib/auth.ts` - delete `currentPermissions`, `permitted`,
  `requirePermission`, `PermittedActor`; drop the now-unused `effectivePermissions`
  and `Permission`/`PermissionSet` imports; a comment records why they are gone.
  `currentActor`, `currentPlatformActor`, `platformAdmin`, `requirePlatformAdmin`,
  session cookie/fingerprint helpers are unchanged.

The `admin-seam-boundary` test still forbids the names, so they cannot return.

## Data & migration impact

No schema change.

## Tests

No behaviour change; these were uncalled. Full web unit suite (109) passes,
`tsc --noEmit` and `next build` clean.

```bash
pnpm -C apps/web exec vitest run
```

## Follow-ups

- `auth_write_standing` self-check keyed on the grant row (next).
- Piece 3, Piece 4.
