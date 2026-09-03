# feat(platform): tenant configuration in the database, and a platform admin to write it

Targets `main`. Platform admin **Phase 4** of `docs/design-platform-admin.md`:
tenant config moves from files to the database with the files as fallback, and
the platform gets its first administrator so a university can be created
without a deploy. Cross-tenant access (Phase 5) is **not** here.

## What

**A finding first.** The design worried about middleware, which runs on the
edge and cannot reach Postgres, needing a snapshot of tenant hosts. It does not:
middleware never resolved a configuration. It takes the subdomain label (or the
`/u/{slug}` path) as the slug and passes it down in `x-tenant-slug`; the first
server component that resolves the slug 404s an unknown one. So there is no
snapshot to publish and the design doc §4 now says so.

**`tenant_configs`** (identity `0012`): `slug` (PK, FK to `universities`),
`config jsonb` (the same shape `tenantConfigSchema` validates for a file),
`version`, `updated_at`, `updated_by`. RLS on, readable by anyone (`USING
(true)`), no FORCE so the schema owner can write it in the sync script.

**Write policies** (same migration): INSERT and UPDATE allowed when a
`platform_roles` row for `current_setting('app.user_id')` holds
`platform_admin`. The subquery runs as the app role under the actor's own
context, and `platform_roles` (FORCE, own row) shows exactly that row, so the
policy holds for a platform admin and matches nothing otherwise. No definer
function, no FORCE change; the FORCE invariant map gains `tenant_configs:
false` deliberately.

**The registry** (`apps/web/lib/tenants.ts`): `getTenantRegistry()` builds the
registry from `listTenantConfigs()` merged over `fileTenantConfigs`
(`mergeTenantConfigs` in core). Per slug a valid row wins; a missing row falls
back to the file; an invalid row, a database that is down, or a merged set the
registry rejects (a duplicate alias) is logged and served around with the
files. Cached per process for 30 s, per request by React, invalidated by a
write in that process. Every `tenantRegistry.` call site in the app (39) now
awaits it, and `requireTenant` is async (18 call sites).

**Platform admin bootstrap.** `SUPERADMIN_EMAILS` (comma separated) names who
may become a platform admin. At sign in, `ensurePlatformAdmin` writes the
`platform_roles` row once (own-row policy allows it; audited as
`platform.admin_granted`, `meta.source = 'env'`). Upgrade only, like
`adminEmails`. `platformAdmin()` / `requirePlatformAdmin()` in `lib/auth.ts`
read the row as the person themselves; 404 otherwise.

**Platform host pages.** `/signin` (platform host only; a tenant host's
`/signin` is rewritten by middleware as before) signs in with no tenant.
`/admin`: for a platform admin, every university with a **Database** / **File**
source chip and a "New university" button; for everyone else the placeholder as
before, plus the sign in link. `/admin/tenants/new` and `/admin/tenants/[slug]`
render one form for the whole config (slug is disabled on edit; lists are comma
separated; fields the form does not show are carried over from what was
loaded). `POST /api/platform/tenants` creates; `POST
/api/platform/tenants/[slug]` updates. Both: same origin, per client limit,
404 without the platform role, `{ config }` body, a slug or alias the registry
already resolves refused as 409 before anything is written, `invalid` as 400
with the fields named.

**Module** (`@campusos/module-identity`): `./platform` (`ensurePlatformAdmin`,
`isPlatformAdmin`, `isAllowlisted`), `./tenants` (`createTenant`: universities
row, config row, `ensureSystemRoles`, one `tenant.created` audit line, in one
transaction, with the universities insert a no-op on conflict so a race ends
in one tenant and one `exists`; `updateTenantConfig`: slug immutable,
universities kept in step, `tenant.updated` at the next version).

**Sync script.** `pnpm tenants:sync` copies every file config into the
database as the schema owner (parameterised, via the new
`withMigrationClient`); `--check` reports each slug's source and version.

## Data & migration impact

- `packages/modules/identity/drizzle/0012_tenant_configs.sql`: the table, RLS,
  the read policy and the two write policies. **Why identity and not base:**
  the base folder and the timetable module share drizzle's default
  `__drizzle_migrations` table, and drizzle applies only entries dated after
  the last one recorded. A new base migration therefore cannot be dated to
  apply on both a fresh database (it must precede timetable's entries, which
  then record later) and an existing one (it must follow them). The first
  version of this PR tried, and CI's fresh database skipped every timetable
  migration as a result. The base folder stays frozen; the identity module has
  its own bookkeeping table and can grow. Giving timetable its own table (a
  one-time row transfer) is a follow-up.
- Backwards compatible: an empty table changes nothing; every tenant serves from
  its file until a row exists. Human steps are in
  `docs/runbooks/tenant-config-to-db.md`: migrate, set `SUPERADMIN_EMAILS`,
  sign in on the platform host, then move LGU with one save or
  `pnpm tenants:sync`. Rollback is `delete from tenant_configs where slug =
'lgu'`; the file answers again within 30 s.
- `.env.example` documents `SUPERADMIN_EMAILS`; `ecosystem.config.cjs` forwards
  it.

## Tests

- Unit: `mergeTenantConfigs` (row wins, database only tenant, invalid row falls
  back and is reported, slug mismatch refused, files alone); `parseEmailList`.
  `pnpm turbo run typecheck lint test`: 23 tasks green (core 38, web 73,
  identity 47, timetable 56, adapter 12).
- Integration (identity suite, CI): a listed address becomes a platform admin
  once with one audit line and an unlisted one never; `createTenant` yields a
  row readable with no context, the universities row, the three system roles
  and exactly one `tenant.created` line, then `exists` and `invalid`; a student
  is refused at the application **and a direct insert under their own context
  is refused by the row policy**; `updateTenantConfig` writes version 1 for a
  universities row with no config (LGU's situation), version 2 next, keeps
  `universities.name` in step, refuses `slug_mismatch` and `not_found`.
- e2e: `/admin/tenants/new`, `/admin/tenants/lgu` and both mutation routes are
  404 on the platform host without the role; `/signin` on the platform host is
  200; the existing `/admin` placeholder assertions still hold. `pnpm --filter web test:e2e`: 66 passed
  against a production build (one cold-start `waitForURL` timeout on the first
  run, clean on the rerun); `pnpm --filter web build` clean.
- Local: `pnpm db:migrate:all` applies `0004` then `0012`; `pnpm tenants:sync
--check` reads "lgu: file only", `pnpm tenants:sync` writes version 1,
  `--check` reads "database, version 1".
- Browser (local dev server, a minted platform admin): `/admin` lists LGU with
  the **Database** chip after the sync; `/admin/tenants/new` creates "Test
  University" (`testu`, one email domain, a description) and lands back on the
  list with both chips reading Database; `/u/testu` renders its heading and
  description from the row alone, with no file; `/admin/tenants/testu` renders
  the edit form; the landing lists both universities. One real bug found and
  fixed on the way: the slug `pattern` had an unescaped hyphen in a character
  class, which browsers (v flag) reject, silently aborting the submit.

## Verification steps

Follow `docs/runbooks/tenant-config-to-db.md`. Then create a second university
in `/admin`, open its host (or `/u/<slug>` in dev): it renders with its own name
and accent with no file and no deploy.

## Follow-ups

- Give the timetable module its own migration bookkeeping table so the base
  folder can take migrations again (one-time transfer of its rows).
- Removing `tenants/lgu/tenant.config.ts` once the row has served for a while
  (a one line change to `tenants/index.ts`).
- The `universities` table itself has no RLS (status quo); creation is gated in
  code and by the config row's policy. Enabling RLS there ripples into every
  test suite's setup and is a separate change.
- Tenant deletion and slug aliases across tenants are not offered in the UI.
- Phase 5 is a plan for review, not a build.
