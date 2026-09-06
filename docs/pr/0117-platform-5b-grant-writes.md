# feat(platform): 5B piece 2c - cross-tenant admin writes through the seam

The first PR where a platform admin's mutations write into another tenant. Every
tenant-admin write now enters the grant through the `withTenantAccess` seam,
carries the grant use row into the `0019` definer, and is audited; nothing
mutating is reachable outside the seam.

## How a god-mode write runs

A `0019` mutation definer authorises a platform admin only when a
`platform_grant_uses` row exists for the current transaction. So the definer call
must run inside the granted transaction:

- `@campusos/db` gains `withTenantMutation(actorUserId, tenantId, access, fn)`:
  `access.via === 'grant'` runs `fn` inside `withGrantedTenant` (which stamps the
  use row) and asserts the open grant is for THIS tenant before doing anything;
  otherwise it is the ordinary membership transaction. So a write can never act
  on a tenant other than the one whose grant is open.
- The identity mutations take an optional `access` and use it: `grantRole`,
  `revokeRole` (rbac), `setStanding`, `liftStanding` (standing), `decideRequest`,
  `verifyMember` (verification). Existing callers pass none and get the member
  path unchanged.
- The seam's `tenantWriteContext(slug, permission)` resolves the context (grant
  precedence over membership), checks the permission, and returns `{actor,
access}` or null. No silent fallback: a platform admin with no grant for the
  slug and no membership is null (404), never quietly the member path.

## Routes through the seam

Every admin mutation route swaps its direct `permitted(...)` gate for
`tenantWriteContext(...)` and passes `write.access` into the mutation:
`app/api/admin/{roles, members/status, verification, members/verify}` and the
tenant-tree rename routes `app/u/[slug]/admin/rooms/{rename, buildings/rename}`.

Room renames write ROOMS, which are tenant-isolated via `getAdminRooms(slug)`
(the repository sets the RLS tenant context) and have no `0019` definer, so the
grant-aware gate is the authorisation and the access is recorded by the use row
the gate stamps; the write is confined to the gated tenant by `app.tenant_id`.

The not-self-under-grant containment and the definer's own permission re-check
are unchanged and still hold through the seam path.

## Boundary is enforced, not conventional

`apps/web/test/admin-seam-boundary.test.ts` now covers BOTH
`app/u/[slug]/admin/**` and `app/api/admin/**` and forbids `requirePermission`,
`currentPermissions`, `permitted`, and `withActor`/`withActorInTenant` in any
admin surface. A new mutation that bypasses the seam fails the test.

## Security review

Adversarial concrete-code pass on the write path per CLAUDE.md §6 (even with no
new SQL, because this turns on cross-tenant writes). It enumerated every app-code
caller of the identity mutation functions and the `0019` definers and found the
identity write path SOUND: every mutation enters through the one seam, carries the
use row into the SAME transaction as the definer (`auth_assume` forces the txid
the definer reads), is tenant-matched at three layers (seam `tryGrant`,
`withTenantMutation`, and the definer's `g.tenant_id = p_tenant_id`), contains
self-promotion on the unforgeable grant row, and is grant-stamped in `audit_log`.
`permitted`/`requirePermission`/`currentPermissions` are used nowhere in
`apps/web` outside tests; on the bare pool a platform admin resolves to zero
tenant permissions, so any non-seam path is fail-closed for god-mode.

One concrete finding (Low, accountability), fixed here: the rooms/buildings
rename god-mode path was tenant-isolation sound but landed with no grant use row
and no audit line. Fixed by recording a grant-stamped audit line for a god-mode
rename via `auditTenantAdminAction` under `withTenantMutation` (stamps the use row
and the trigger stamps the grant id), so the access is logged like every other
god-mode write. The boundary test additionally now forbids `withTenant` /
`withGrantedTenant` in admin surfaces (no hand-rolled context).

Two non-blocking follow-ups the review noted: remove the now-dead
`permitted`/`requirePermission`/`currentPermissions` from `lib/auth.ts` (latent
bypass primitive, unused); and key `auth_write_standing`'s self-check on
`auth_grant_admin_for_txn()` for consistency (currently `app.user_id`, but
non-exploitable: standing only updates an existing membership and a god-mode admin
has none, so a self-target is `not_found`). Both are follow-ups, not 2c blockers.

## Data & migration impact

No schema change. No new SQL.

## Tests

- `admin-seam-boundary.test.ts`: both admin trees, all direct gates forbidden.
- `isolation.integration.test.ts` (CI, split PG): a granted admin drives
  `grantRole` through the definer under the grant and is refused self-promotion;
  a grant for one tenant cannot drive a write into another
  (`withTenantMutation` guard).

```bash
pnpm -C apps/web exec vitest run && pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` (web/identity/db), `next build`, web unit (109), identity unit
  (47) pass; integration in CI.
- Operator: as a platform admin under a grant, grant a role / set a standing /
  decide a verification / rename a room in another tenant, and confirm it lands,
  is audited under the grant, and that self-promotion is refused.

## Follow-ups

- Piece 3: typed `/admin?grant=expired` redirect on mid-request expiry + 10s
  `statement_timeout` on granted transactions. Piece 4: tenant transparency panel.
