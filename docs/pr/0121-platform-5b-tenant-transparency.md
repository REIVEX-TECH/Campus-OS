# feat(platform): 5B piece 4 - tenant transparency panel

The last Phase 5B piece. A university's own admins can see which CampusOS platform
administrators entered their tenant, when, and why.

## What

- `packages/modules/identity/src/grants.ts` - `tenantGrantsFor(actorUserId,
tenantId)` reads `auth_tenant_grants_for_tenant` (0018) and maps the rows.
  That definer reads from membership and requires `restrict-members`, NOT through
  a grant, so a visiting platform admin sees nothing even while holding the grant;
  the tenant's resident admins see the full record.
- `apps/web/app/u/[slug]/admin/platform-access/page.tsx` - a new admin section:
  each grant shows the platform admin's handle, the reason, when they entered, and
  status (in now until X / expired X / ended X). Empty state when none. Goes
  through the seam (`accessForPage(slug, 'restrict-members')`), so the boundary
  test covers it.
- `apps/web/lib/admin-sections.ts` - the "Platform access" section (gated on
  `restrict-members`, matching the definer) joins the admin nav and the bare
  `/admin` forward.

Handles only, never emails; no dashes or divider lines; light + dark; AA.

## Data & migration impact

No schema change. No new SQL (reads the existing 0018 definer).

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` (CI, split PG): a
resident admin of a tenant sees a grant into it with its reason; the visiting
platform admin, even holding the grant, sees nothing (the record is read from
membership, never through a grant).

```bash
pnpm -C apps/web exec vitest run && pnpm -C packages/modules/identity test:integration
```

## Verification steps

- `tsc --noEmit` (identity/web), `next build`, web unit (110) pass; the
  integration assertion runs in CI.
- Operator: as a resident tenant admin, open Admin -> Platform access; after a
  platform admin has entered, the entry is listed with who/when/why.

## Follow-ups

Phase 5B is complete: platform login, session-end revocation, the tenant-access
seam, cross-tenant reads and writes through it, grant expiry handling, and this
transparency panel. Remaining unrelated queued work: the verification UX feature
and the timetable e2e deflake.
