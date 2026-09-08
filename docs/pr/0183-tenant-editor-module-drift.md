# feat(platform): warn when a tenant's DB modules differ from its file

Block A item 1. The platform tenant editor now shows a warning when a university's
**database** `enabledModules` differ from its checked-in **file** config, listing the
difference, so an operator is never surprised that what is live is not what the repo
says.

## What

- `tenantModuleDivergence(slug)` in `apps/web/lib/tenants.ts`: null when there is no
  database row (the file is authoritative) or when the two match; otherwise the
  modules on-in-the-database-but-not-the-file and in-the-file-but-off-live (the
  database wins). Computed from the already-loaded registry (effective = database
  when the source is a row) against `fileTenantConfigs`; no extra query.
- A warning banner on `/admin/tenants/[slug]` (platform admins only) that lists both
  differences. Shown only when there is drift.
- i18n: `platform.admin.drift.*`.

## Data & migration impact

No schema change. Read-only.

## Tests

Web typecheck, lint, no-dash, and a full build pass. No unit test: the helper is a
set difference over the existing registry; the value is the banner, which the
existing platform-admin e2e covers by rendering the page.

## Verification

For a tenant with a DB row whose `enabledModules` differ from its file (e.g. LGU if
a row turns a module on/off), `/admin/tenants/lgu` shows the amber banner listing
the difference; for a file-only tenant, or one whose row matches, no banner.

## Follow-ups

None. Part of the Block A leftovers.
