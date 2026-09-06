# chore(identity): retire config-seeded tenant admins

Phase 5B, item 3b. Closes the 0016 residual trust boundary for good: a
DB-editable value must never decide who is an administrator. The `adminEmails`
config list and the sign-in path that read it are removed. The one-time `0023`
migration already converted every existing config admin into a real
`tenant_memberships` row (run in production; LGU admin confirmed as a real
membership), so no access is lost. `tenant_admin` is now granted only through the
roles UI under a grant or by an existing admin (`auth_set_membership_role`).

## What is removed

- `adminEmails` from `tenantConfigSchema` (packages/core) and from the platform
  create/edit form, its labels, and its i18n. `createTenant`/`updateTenantConfig`
  no longer carry it. Existing stored configs that still contain the key parse
  fine: the schema is a plain object, so the unknown key is stripped and ignored.
- `ensureConfiguredAdmin` and `isConfiguredAdmin` (packages/modules/identity) and
  the sign-in call in `apps/web/app/api/auth/session/route.ts`. Signing in now has
  exactly one membership consequence: domain self-verification.
- The `auth_grant_configured_admin` definer, dropped in identity `0025`
  (`DROP FUNCTION IF EXISTS`) and removed from the `DEFINER_INTENT` map, so the
  self-promotion primitive cannot be reached at all.
- `adminEmails: [...]` from `tenants/lgu/tenant.config.ts`.
- The one-time 3a tooling (`scripts/migrate-configured-admins.ts`, the
  `admins:migrate` script, `docs/runbooks/retire-admin-emails.md`), which has done
  its job. Its record survives in git and PR #123.

`SUPERADMIN_EMAILS` / `ensurePlatformAdmin` is a separate, intended mechanism
(the platform-admin bootstrap, not tenant admin) and is untouched. The owner-only
`auth_migrate_configured_admin` (0023) is left in place: it is revoked from the
app role and cannot seed anything at runtime.

## Boundary test

`apps/web/test/no-configured-admins.test.ts` scans the live code
(src / app / lib / tenants / messages) and fails if
`ensureConfiguredAdmin`, `isConfiguredAdmin`, `adminEmails`, or
`auth_grant_configured_admin` reappear. It deliberately does not scan the drizzle
migrations (immutable history: 0019 created, 0023 converted, 0025 dropped), the
tests (they name it to explain the replacement), or docs/pr. A future "just add
it back" has to delete this test to land.

## Data & migration impact

Migration `0025` drops one function; no table or data change. `adminEmails` values
left in existing `tenant_configs.config` jsonb are inert (stripped on parse); no
cleanup required. Not reversible in effect (re-adding the field would reopen the
boundary), and there is nothing to roll back.

## Tests

- New boundary test (above).
- The identity + communities integration `admin`/`adminIn` helpers now seed a
  `tenant_admin` membership + role as the owner (the roles-UI equivalent), so the
  many tests relying on a resident admin still exercise real admin authority.
- The `configured admins` describe (which tested the removed function) is deleted.

```bash
pnpm -C apps/web test
pnpm -C packages/modules/identity test:integration
```

## Docs

`docs/DEPLOY.md`, `docs/DEPLOY-VPS.md`, and `docs/design-platform-admin.md` are
updated: tenant admins are granted through the roles UI, not a config list.

## Follow-ups

- 3c: bootstrap UX (create-tenant states the first admin must sign in once;
  find-a-user-by-email in the roles UI under a grant).
