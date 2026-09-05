# feat(identity): bootstrap a tenant's first admin by email

Phase 5B, item 3c. Now that `tenant_admin` is only ever granted (never seeded from
config, retired in 3b), a new university starts with nobody who can administer it.
This adds the bootstrap path: a platform admin (entered on a grant) or an existing
admin grants the first administrator by the email they know, and the create-tenant
flow says how.

## What

- **Find a member by email** (identity `0026`): `auth_find_member_by_email(tenant,
email)`, an app-callable `SECURITY DEFINER`. Emails are private (the users table
  is self-only under RLS), so the lookup is owner-run and gated on `manage-roles`
  via `auth_effective_permissions` -- membership for a resident admin, the grant
  branch for a platform admin under an open grant for this tenant (re-checks
  platform-admin + liveness + tenant). It resolves an email **only to a member of
  this tenant**: a person with an account but no membership here, and a person
  with no account at all, both return nothing, so a tenant admin cannot enumerate
  accounts across tenants. It returns the public handle, verified state, and role
  keys, never the email or other PII.
- **Roles-page affordance**: a "Grant an administrator by email" section on
  `/u/[slug]/admin/roles` (`manage-roles`). Two steps on purpose -- find, then
  confirm the handle before granting, so admin is never granted to the wrong
  person. Find posts to a new `/api/admin/roles/find` route (seam-gated,
  rate-limited); the grant reuses the existing `/api/admin/roles` route
  (`auth_set_membership_role`). "No member found" tells the admin to have the
  person sign in to the university once, which is the correct next step whether or
  not they have an account.
- **Create-tenant messaging**: the new-university page states that a university
  starts with no administrators, and how to grant the first one.

## Why this shape

The person must have signed in to the university once (which gives them a
membership) before they can be granted -- so the lookup only ever needs to find
members, which is also what makes it enumeration-safe. A platform admin does this
under a grant (audited); an existing admin can do it directly.

## Data & migration impact

Migration `0026`: one app-callable definer, no schema/table change, writes no
data. Backwards-compatible; no rollback needed.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` -- a new
`describe('finding a member by email (0026)')`:

- an admin finds a member by email, case-insensitively (handle, verified, roles);
- a non-member and an unknown email both return nothing (no cross-tenant leak);
- a caller without `manage-roles` gets nothing;
- a platform admin under a grant finds a member, and a grant for another tenant
  does not.

`auth_find_member_by_email: 'app'` added to the now-live `DEFINER_INTENT` map.

```bash
pnpm -C apps/web test
pnpm -C packages/modules/identity test:integration
```

## Verification

Create a university; its first person signs in to it once; enter it on a grant,
open `/u/{slug}/admin/roles`, find them by email, and grant administrator. A wrong
or not-yet-joined email reports "no member found".

## Follow-ups

- Item 3 (DB tenant config / membership governance) is complete with this.
