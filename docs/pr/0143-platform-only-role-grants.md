# feat(identity): only platform admins assign tenant roles (§6, §8)

Block 1.5b. A resident tenant administrator manages members and everything else,
but no longer assigns or revokes tenant roles: that is lifted to a platform admin
acting under an audited, time-boxed grant. Adds/changes RLS-gated authorization
(the resolver) and a privilege grant, so §6 (concrete SQL) applies.

## Why

Granting a role — `tenant_admin` above all — is the sharpest self-perpetuating
power in a tenant: a resident admin holding it can mint co-admins and entrench
themselves beyond the platform's reach. The write was already contained to a live
grant use-row for the platform path (0029); this removes the resident path
entirely, so role assignment is only ever done by the platform operator, under a
grant, and audited.

## What (migration 0032)

- **Drop `manage-roles` from the tenant_admin template, re-sync every tenant.**
  `auth_sync_tenant_roles` reconciles each tenant's materialized `role_permissions`
  to exactly the template set (a full reconcile: it deletes perms no longer in the
  template), so this strips `manage-roles` from every tenant_admin role.
- **Re-define `auth_effective_permissions`.** Membership branch unchanged; grant
  branch unchanged except it now also yields `manage-roles` for a platform admin
  under a live grant — added back explicitly (a `UNION SELECT 'manage-roles'`
  keyed on the same unforgeable `pg_current_xact_id_if_assigned()` use-row),
  because the strip above removed it from the tenant_admin `role_permissions` the
  grant branch reads. A platform admin needs it to pass the roles API gate.
  `communities.unmask` stays excluded; `view-member-identity` (0031) is not.
- **`auth_set_membership_role` (0029) is untouched.** A resident fails its
  `manage-roles` gate (`not_allowed`); a platform admin under a grant passes via
  the `v_from_platform` exemption. Keep-one-admin and not-self-under-grant hold.
- **`SYSTEM_ROLES.tenant_admin` (core, TS)** drops `manage-roles` too, so the code
  mirror stays honest (it is not the DB seed source, but the catalogue test pins
  the two reserved exclusions).

## §6 (concrete SQL)

- The added grant-branch row is keyed on the live grant use-row for the current
  transaction (`u.txid = pg_current_xact_id_if_assigned()`), a platform_admin
  role, and a live session — never on a GUC (§8). It grants `manage-roles` to a
  platform admin under a grant and to no one else.
- A resident tenant_admin resolves to a permission set WITHOUT `manage-roles`, so
  every gate on it (the roles API `tenantWriteContext`, and `auth_set_membership_role`'s
  own check) refuses them.
- No table's RLS changes; the resolver is `SECURITY DEFINER` and keeps its app
  EXECUTE (declared `app` in the DEFINER_INTENT registry).

## UI

- `/u/[slug]/admin/roles` is now gated on `manage-members` and read-only for a
  resident: they see the role catalogue and a note that role assignment is managed
  by the platform team. The grant-by-email control renders only for a holder of
  `manage-roles` (a platform admin under a grant). The roles nav entry moved to
  `manage-members` so residents can still reach the read-only page.
- Both `/api/admin/roles` write routes keep their `manage-roles` gate, so a
  resident who forges a POST is 404'd before the definer.

## Data & migration impact

Identity migration `0032_platform_only_role_grants` (journal idx 32): one template
delete + a full re-sync of every tenant, and a redefinition of
`auth_effective_permissions`. Backwards-compatible; the rollback is to re-add the
template row + re-sync and restore the 0018 resolver body. Applies cleanly
(verified locally against the dev DB up to the split check).

## Tests

- `isolation.integration.test.ts`: a resident admin now lacks `manage-roles` and is
  refused both directions of `auth_set_membership_role` (`not_allowed`); role
  assignment/revocation is exercised through a platform admin under a grant (new
  `grantUnderGrant`/`revokeUnderGrant` helpers); the keep-one-admin rule holds
  under a grant; not-self-under-grant still refuses; setup grants that only need a
  member to HOLD a role attach it directly (`seedRole`). The under-grant resolver
  still yields `manage-roles` (the grant-branch canary).
- `communities.integration.test.ts`: a resident admin granting `trust-and-safety`
  is now `not_allowed` (was `above_own`); the platform-under-grant path still
  assigns it.
- `core/test/rbac.test.ts`: `SYSTEM_ROLES.tenant_admin` excludes both
  `communities.unmask` and `manage-roles`.
- `admin-sections.test.ts`: the roles nav is `manage-members` and visible to a
  resident (read-only). `admin-seam-boundary.test.ts`: a new check pins that both
  `/api/admin/roles` write routes gate on `manage-roles`.

```bash
pnpm -C packages/modules/identity test:integration
pnpm --filter @campusos/core test && pnpm --filter web test
```

## Verification

```bash
pnpm --filter web build
```

- As a resident tenant admin, `/u/lgu/admin/roles` shows the catalogue and the
  platform-managed note, no grant control; the members page shows no role chips.
- As a platform admin under a grant, the grant-by-email control and role chips
  appear and work.

## Follow-ups

- `above_own` containment is now reachable only by a (hypothetical) non-platform
  holder of a custom role carrying `manage-roles`; it is retained but effectively
  dormant. No action needed unless such a role is ever defined.
