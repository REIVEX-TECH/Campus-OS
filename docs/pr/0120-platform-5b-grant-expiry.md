# feat(platform): 5B piece 3 - grant statement_timeout + typed expiry redirect

Bounds granted transactions and makes a grant that ends mid-session a clear,
typed redirect rather than a bare 404 or a raw 500.

## Changes

- `packages/db/src/tenant-context.ts` - every granted transaction (`withGrantedTenant`
  and `withPlatformGrant`) runs `SET LOCAL statement_timeout = '10000ms'`. A
  cross-tenant admin action is a short interactive write; nothing long-running
  should run under a grant, so hitting this is a design smell to fix, not a limit
  to raise. Transaction-local, so it never leaks on the pooled connection.
- `apps/web/lib/tenant-access.ts` - a platform admin who reaches a granted surface
  with no active grant for it (expired, closed, or a statement that timed out) is
  redirected to `/admin?grant=expired&tenant={slug}`. `tryGrant` now also treats a
  statement timeout (`57014`) as "no usable grant", so a granted request never
  surfaces a raw 500. No silent fallback to the member path.
- `apps/web/app/admin/page.tsx` - reads `?grant=expired&tenant=` and shows a
  status banner naming the tenant, so the way back in (its Enter control) is
  obvious. Informational; it clears on navigation.
- `apps/web/app/u/[slug]/admin/page.tsx` - the bare entry redirect matches.

## Data & migration impact

No schema change. No new SQL (`SET LOCAL` is app-level).

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` (CI, split PG): a
granted transaction reports `statement_timeout = '10s'`.

```bash
pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` (db/identity/web), `next build`, web unit (109) pass; the
  timeout assertion runs in CI.
- Operator: as a platform admin, let a grant expire (or close it in another tab)
  and hit a tenant-admin page - you land on `/admin` with the "your access ended"
  banner, not a 500; reopen from the list to continue.

## Follow-ups

- Piece 4: tenant transparency panel (`auth_tenant_grants_for_tenant` in the
  tenant's own admin view - who entered, when, why).
