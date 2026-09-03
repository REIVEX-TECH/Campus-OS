# feat(identity): roles and permissions, per tenant

Targets `main`. Phase 1 of `docs/design-platform-admin.md`. Additive: no UI
changes, no behaviour changes for anyone using the site today.

## What

Until now a membership carried one role in a text column, and every admin
surface asked the same question, "are you `tenant_admin` here". That made every
capability all or nothing, so whoever could rename a room could also approve a
verification. This replaces it with permissions.

- **Permissions are a fixed catalogue in code** (`@campusos/core`):
  `manage-timetable`, `manage-rooms`, `approve-verifications`, `manage-members`,
  `manage-roles`, `view-analytics`, `post`, `moderate`. Fixed rather than data,
  because a permission only means something if some code checks it.
- **Roles are tenant-owned data** bundling those permissions. Two tenants may
  both have a role keyed `moderator` meaning different things, and neither can
  see the other's. Three system roles ship with every tenant and cannot be
  deleted, so a tenant cannot remove the role that lets it administer itself.
- **A person may hold several roles in one tenant**, and their effective
  permissions are the union. That is the point: a teacher who also moderates,
  without inventing a `teacher_moderator` role.
- **A suspended member keeps their roles and loses their permissions**, which is
  what makes suspension worth having.
- `requirePermission(slug, permission)` joins `requireTenantAdmin` as the guard,
  404ing rather than refusing so an admin surface never confirms its own
  existence.

## Why the permission check does not read the role tables

Resolving "what may this person do here" needs `membership_roles` and
`role_permissions`. If those were readable to anyone holding the tenant context,
then any signed-in member, whose own permission check sets that context, could
read every other member's roles. **The check would be the leak.**

So the tables are reachable only in a tenant context, which only server code
sets, and per-request resolution goes through `auth_effective_permissions`, a
definer function that answers for one user and one tenant and returns nothing
else. It is the same narrow-privileged-read pattern as `auth_resolve_session`.

Because a definer function runs as the table owner, these three tables enable RLS
**without** `FORCE` — the trap that cost three separate fixes earlier in this
project. The FORCE invariant test now covers them, so the reason is recorded
rather than remembered.

## Migration

`0010_rbac` creates the three tables, their policies and the function, then
seeds every existing tenant's system roles and carries every existing membership
into the new model with the role it already had. Every step is
`ON CONFLICT DO NOTHING`, so it is safe on a database that has been part
migrated and safe to re-run. Nothing is dropped.

`tenant_memberships.role` stays as the member's **primary** role, which is what a
member list shows at a glance. It is no longer what any permission check reads.
Dropping it is a follow-up once nothing displays it.

Rollback: drop the three tables and the function. Nothing else changed.

## Tests

- Unit (9, core): the catalogue has no duplicates and recognises only its own
  members; **an administrator holds every permission in the catalogue**, so
  adding one and forgetting the role fails here rather than silently disabling a
  feature; ordinary members hold nothing administrative; a `PermissionSet`
  ignores a string that is not a permission, so a stale database row cannot
  become a capability.
- Integration (13, CI, split database): every tenant gets three system roles; an
  administrator resolves to every permission and a student to one; a stranger to
  none; **a permission never crosses tenants**; a suspended member loses all
  permissions but keeps their roles; several roles union; grant and revoke are
  refused without `manage-roles`, re-checked inside the transaction; unknown role
  and unknown member refused; **a tenant cannot revoke its last administrator**;
  the role tables read empty without a tenant context; one tenant never sees
  another's assignments; every change leaves an audit line with no address in it.
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build` and
  `pnpm --filter web test:e2e` (57) pass.

## Verification steps

After `pnpm db:migrate:all`:

1. `select key, is_system from roles where tenant_id = 'lgu'` shows the three
   system roles.
2. `select r.key, count(*) from membership_roles mr join roles r on r.id =
mr.role_id group by 1` matches the old `tenant_memberships.role` counts.
3. Sign in as the configured admin: `select * from
auth_effective_permissions('<user-id>', 'lgu')` returns all eight.

## Follow-ups

- Phase 2 puts a UI on this; nothing reads `requirePermission` yet, so the
  existing `requireTenantAdmin` gates are unchanged in this PR and get swapped
  over as each surface moves.
- `tenant_memberships.role` becomes redundant once the member list shows roles
  from the new model.
