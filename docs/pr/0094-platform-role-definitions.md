# feat(identity): role definitions move to the platform administrator

## What

Platform admin phase 6, and addendum items 1 and 2. Which roles exist and what
each one carries becomes a platform level definition that a super admin writes;
a tenant administrator reads the definitions and grants them, and may never
grant a role carrying a permission they do not hold themselves.

## Why

This closes a hole that is live today. `manage-roles` carries both powers, so a
tenant administrator can create a role holding `communities.unmask`, a
permission the catalogue deliberately gives to nobody, and grant it to
themselves. The careful default was one form submission away from being undone
by the person it was written to constrain.

## How

### Schema, `packages/modules/identity/drizzle/0013_role_definitions.sql`

- `role_templates (key, name, is_system, created_at, updated_at)` and
  `role_template_permissions (template_key, permission)`. No `tenant_id` on
  either: a definition is not a tenant's to own. Readable by anyone, since
  "the moderator role may remove posts" is not private and a tenant
  administrator needs it to grant sensibly; written only by a platform
  administrator, by the policy shape `tenant_configs` established in Phase 4.
- The six definitions are seeded here rather than by application code, because
  seeding them is a privilege change and a privilege change should be a
  migration somebody reviewed.
- `roles` and `role_permissions` lose their blanket tenant policies. Reads are
  unchanged, so `listRoles` and `auth_effective_permissions` keep working
  exactly as before; writes now need a platform administrator, or the definer
  function below.
- `auth_sync_tenant_roles(tenant)` materialises the definitions into one
  tenant's rows: upsert, then reconcile permissions to exactly the template's
  set. `SECURITY DEFINER` because every path that needs it is actorless and
  ordinary, a sign in and a first community, and none of them has an
  administrator to hand. It writes only `is_system` rows whose key names a
  template, so it cannot mint a role of a tenant's own. Both new tables keep
  RLS without FORCE, which is what lets the function read them at all.
- Every existing tenant is synced at the end of the migration.
- One visible consequence: a tenant now materialises all six definitions at
  once rather than three, since the community roles are definitions like any
  other. A role nobody holds grants nothing, so a tenant without the
  communities module carries three inert rows; two existing assertions that
  counted three are updated to say so.

### Module

- `src/role-templates.ts`: `listRoleTemplates`, `createRoleTemplate`,
  `setRoleTemplatePermissions`, `deleteRoleTemplate` (system definitions
  refused: deleting `tenant_admin` would lock every university out at once),
  and `syncTenantRoles`. A change to a definition syncs every tenant inside the
  same transaction, because a second connection would not see the change that
  is the reason for syncing.
- `rbac.ts`: `ensureSystemRoles` becomes the sync; `createRole` and
  `setRolePermissions` are gone with the surface that called them; `grantRole`
  gains the rule that was missing, refusing `above_own` when the target role
  carries anything the actor does not hold. A platform administrator is the one
  exemption, and it exists so `communities.unmask` stays reachable: a
  permission nobody can grant is a permission that does not exist. The grant is
  audited either way, and records which path it came through.
- `communities.ts`: `ensureCommunityRoles` is the same sync, since the
  community roles are definitions like any other now.

### Web

- `/admin/roles` on the platform host: the definitions, editable, with a New
  definition form and Retire on a definition of one's own.
- `/u/[slug]/admin/roles` becomes read only and says why, with a link in the
  copy to where grants happen. `api/admin/roles/define` is deleted rather than
  hidden. `api/platform/roles` is new and 404s anyone who is not a platform
  administrator.
- Twelve permissions had no label and rendered as bare keys next to a live
  checkbox, `communities.unmask` among them. All twenty are labelled now.

## Security

The escalation path is closed in two places at once, which is the point: the
application refuses the grant, and the database refuses the write even if the
application did not. A tenant administrator with a tenant context can no longer
INSERT or UPDATE `roles` or `role_permissions` at all. The FORCE maxim holds:
the two new tables and the two tightened ones are all read by definer
functions, so none of them takes FORCE.

This does not begin Phase 5. A platform administrator gains no tenant
permission set and no tenant reading surface; the definitions live on the
platform host, which has no tenant context, and the one place a platform
administrator reaches into a tenant is `grantRole`, by the same named,
single-purpose pattern `createTenant` already uses.

## Tests

- Integration, identity (three cases rewritten, and they invert): the platform
  defines a role and **both** tenants receive it; changing a definition changes
  what a holder may do; a tenant administrator is refused create, change and
  delete, a student likewise; a system definition is refused even to the
  platform; a tenant administrator granting a role carrying
  `communities.unmask` is refused `above_own` and the target holds nothing,
  while the platform administrator's grant succeeds; a role carrying only what
  the administrator holds still grants; a definition is shared across tenants
  while a grant is not. `pnpm turbo run typecheck lint test`: 26 tasks green.
  The identity integration suite is CI only (it needs the split database);
  locally `pnpm --filter @campusos/module-communities test:integration`: 34
  passed, 1 skipped. `pnpm --filter web build` clean, two new routes.
- Integration, communities: the unmask suite now has the tenant administrator
  refused `above_own` before the platform grant that lets the rest of the case
  proceed.
- Unit: the key derivation moved with the definitions.
- e2e (one new case): `/admin/roles` is 404 without the platform role, the
  platform write route is 404, and the retired tenant route is 404.
  `pnpm --filter web test:e2e`: 85 passed against a
  production build.
- Browser (local dev server, signed in as a platform administrator): the
  tenant roles page lists all seven roles with their permissions as pills, no
  checkbox and no save control anywhere, under the note that definitions are
  set for every university at once; `/admin/roles` lists the six definitions
  with the full permission grid and a New definition form. Creating "Course
  Rep" with `view-analytics` put it on the tenant page with that permission;
  changing the definition to `post` and `moderate` changed the tenant's copy
  to match; retiring it returned 200 and retiring `tenant_admin` returned 409
  `system_template`.

## Verification steps

Run the migration (below). As a platform administrator open `/admin/roles`,
add a definition, and find it read only on a university's `/admin/roles` with
the same permissions; change the definition and watch the university's copy
follow. As a tenant administrator, try to grant a role carrying a permission
you do not hold and read the refusal.

## Migration notes

`packages/modules/identity/drizzle/0013_role_definitions.sql`, applied by
`pnpm db:migrate:all`. It changes policies on two live tables, so it is the
most delicate migration since Phase 4: reads are untouched, and the writes it
removes were only ever reachable from the surface this PR deletes. Rollback:
recreate `roles_in_tenant` and `role_permissions_in_tenant` with their old
`USING`/`WITH CHECK` pair, drop the six new policies, drop
`auth_sync_tenant_roles`, and drop the two tables. No data is lost by the
rollback: every tenant's roles are ordinary rows either way. Your step on the
live database.

## Breaking changes

`createRole` and `setRolePermissions` are gone from
`@campusos/module-identity/rbac`, along with `roleKeyFromName` and
`ROLE_KEY_PATTERN`, which now live in `role-templates.ts` under
`templateKeyFromName` and `TEMPLATE_KEY_PATTERN`. `POST
/api/admin/roles/define` is removed. Nothing outside this repository calls
them.

## Follow-ups

- A tenant's roles created before this PR are left standing and are no longer
  editable by anyone; the platform can define an equivalent and the old row can
  be dropped by hand. There is no such row in production today.
- Retiring a definition leaves each tenant's copy in place on purpose. Taking a
  role off everyone holding it is a separate act somebody should have to mean,
  and it has no surface yet.
