# feat(platform): 5B piece 2 - tenant-access seam, grant lifecycle UI

Phase 5B, piece 2: the `withTenantAccess` seam plus the grant open/close UX. Read
pages and the admin layout run through the seam; all writes still 404 for a
granted admin (fail-closed), so this is safe to deploy before piece 2c wires the
mutations.

## The seam (`apps/web/lib/tenant-access.ts`)

One boundary decides which context a tenant-admin request runs in, resolved once
per request (React `cache`) so the layout and page agree and stamp one grant use
row between them:

- **GRANT precedence.** A platform admin with an open grant FOR THIS SLUG runs in
  the granted context even if they also hold a membership. Opening a grant is an
  explicit, audited act, so its presence signals intent. Permissions resolve
  through the grant branch (tenant_admin minus communities.unmask).
- **No silent fallback, either direction.** A grant whose tenant is not this slug
  is a typed mismatch, and an absent grant for a platform admin who is not a
  member here is a redirect to `/admin?enter={slug}` - never a quiet drop to the
  member path. A member with no grant simply resolves as a member.

`accessForPage(slug, permission)` replaces `requirePermission` on every read page;
`tenantAccess(slug)` (bare /admin entry) and `tenantAccessContext(slug)` (layout
banner) expose the same cached resolution. No new SQL: the seam captures the
`{tenant_id, expires_at, reason}` that `auth_assume_tenant_grant` already returns
(`withGrantedTenant` now passes it to `fn`) and asserts `tenant_id == slug`.

## Lifecycle UI

- **Enter** (platform `/admin` list) opens the reason modal -> `POST
/api/platform/grants` (`withPlatformGrant`, 30 min) -> navigates to
  `/u/{slug}/admin`.
- **Reason modal**: reason starts EMPTY, minimum 12 characters; on reopen the
  previous reason is a one-tap "same reason" chip that fills the editable field,
  never silently prefilled. Portal + inert + focus trap + Escape, matching the
  avatar picker; light/dark; no dashes or divider lines; AA.
- **Countdown banner** (admin layout, granted context only): which tenant and why,
  a live countdown, Close; under 2 minutes it warns and offers Reopen (a fresh,
  explicitly typed grant, not an extension).
- **Redirect**: a platform admin with no grant for the tenant hitting
  `/u/{slug}/admin` is sent to `/admin?enter={slug}`, not a 404.

## Fail-closed intermediate state

Writes are untouched: the mutation endpoints (`app/api/admin/**`, the tenant-tree
rename routes) still gate with the old, grant-unaware check, so a granted admin
can view but every write 404s. Piece 2c routes those through the seam.

## Files

- `packages/db/src/tenant-context.ts` - `withGrantedTenant` passes the assumed
  grant to `fn`.
- `packages/modules/identity/src/sessions.ts` - `resolveSessionActor` exposes the
  session id without widening `Actor`.
- `packages/modules/identity/src/grants.ts` (+ `./grants` export) -
  `revokeTenantGrant`, so app code never hand-writes the definer.
- `apps/web/lib/auth.ts` - `currentPlatformActor`.
- `apps/web/lib/tenant-access.ts` - the seam.
- `apps/web/lib/grant-labels.ts`, `app/_components/admin/{grant-reason-modal,
enter-tenant-button,grant-banner}.tsx` - the UI.
- `apps/web/app/api/platform/grants/{route,close/route}.ts` - open/close.
- `apps/web/app/u/[slug]/admin/{layout,page,analytics,communities,members,roles,
rooms,verification}` - through the seam.
- `apps/web/app/admin/page.tsx` - Enter control. `messages/en.ts` - strings.

## Data & migration impact

No schema change. No new SQL.

## Tests

- `apps/web/test/admin-seam-boundary.test.ts`: every read page under
  `app/u/[slug]/admin/**` resolves access through the seam (no `requirePermission`
  / `currentPermissions`). Piece 2c extends this to the write endpoints.
- `packages/modules/identity/test/isolation.integration.test.ts`: a grant for one
  tenant resolves permissions for that tenant and NONE for another, in the granted
  transaction - the resolver keys on the grant's tenant, underneath the seam's
  mismatch guard.

```bash
pnpm -C apps/web exec vitest run && pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` (web, identity, db), `next build`, web unit (105) and identity
  unit (47) all pass; the integration assertion runs in CI.
- Manual (operator): as a platform admin, Enter a tenant from `/admin`, see the
  countdown banner in its admin, Close, and confirm a write still 404s.

## Follow-ups

- Piece 2c: route `app/api/admin/**` and the tenant-tree rename routes through the
  seam (god-mode writes through the 0019 definers); extend the boundary test.
- Piece 3: typed `/admin?grant=expired` redirect on mid-request expiry, 10s
  `statement_timeout` on granted transactions. Piece 4: tenant transparency panel.
