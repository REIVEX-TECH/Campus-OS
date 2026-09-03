# feat(identity): members and roles admin on the RBAC foundation

Targets `main`. Platform admin **Phase 2** of `docs/design-platform-admin.md`:
the tenant admin area now runs on permissions end to end, and gains the two
screens the RBAC tables were built for.

## What

**One guard.** `requireTenantAdmin` and `tenantAdmin` are gone. Every admin
page and mutation gates on the permission it actually needs, resolved on the
request by `requirePermission` / `permitted` and re-checked inside the
transaction that does the work:

| Surface                                                       | Permission              |
| ------------------------------------------------------------- | ----------------------- |
| `/admin/verification`, `/api/admin/verification`, `…/verify`  | `approve-verifications` |
| `/admin/members`, `/api/admin/members/status`                 | `manage-members`        |
| `/admin/roles`, `/api/admin/roles`, `/api/admin/roles/define` | `manage-roles`          |
| `/admin/rooms`, `…/rooms/rename`, `…/rooms/buildings/rename`  | `manage-rooms`          |
| `/admin/analytics`                                            | `view-analytics`        |

Inside the identity module the verification flow's `isTenantAdmin` row check is
replaced by `canInTransaction(tx, …, 'approve-verifications')`, so a role of the
tenant's own that carries that permission can work the queue, and a
`tenant_admin` still can because it holds everything.

**Members** (`/admin/members`): every member, newest first, with the roles they
hold read from `membership_roles` (not the legacy `tenant_memberships.role`
column, which nothing displays any more), their verification state, and a
suspend / reinstate control. Someone who also holds `manage-roles` sees a
remove control on each role chip and an "Add a role" select per member. Handles
only; no email anywhere on the page.

**Roles** (`/admin/roles`): the three built in roles with their permissions,
read only, and each role of the tenant's own as a checkbox grid with a Save
button; a "New role" form at the bottom. Permission names are translated
strings; a tenant's own role names are shown as the tenant typed them.

**Shared nav.** One `AdminNav` lists the sections the signed in person may open,
from a single `ADMIN_SECTIONS` table; the bare `/admin` entry forwards to the
first of them, and the account page's admin link points there too. Someone
holding no section permission has no admin area at all, and every one of these
surfaces is a 404 to them.

## Module additions (`@campusos/module-identity`)

- `members.ts` (new export `./members`): `listMembers` (with `roles: string[]`
  per member, `manage-members`), `setMemberStatus` (suspend / reinstate;
  refuses oneself and the last active `tenant_admin`; idempotent; audited as
  `member.suspended` / `member.reinstated`).
- `rbac.ts`: `createRole` (key derived from the name, hyphenated, so it can never
  shadow an underscore system key; a name that derives an existing key is
  refused as `exists` at the unique index, never an aborted transaction),
  `setRolePermissions` (refuses system roles; idempotent; audited as
  `role.changed`), `roleKeyFromName`, `ROLE_KEY_PATTERN`.

A suspended member keeps their account and profile but resolves to no
permissions in that tenant: `auth_effective_permissions` only answers for active
memberships, so the change lands on their next request.

## Security notes

- Same shape as every earlier admin mutation: same origin, per client limit, then
  404 without the permission, then the permission again inside the transaction.
- Suspension cannot lock a tenant out: the last active administrator cannot be
  suspended, in the same way the last `tenant_admin` role cannot be revoked.
- No RLS change, no FORCE change. The role tables stay readable only in a tenant
  context; the member list is built inside one.

## Data & migration impact

No schema change. The follow-up to drop `tenant_memberships.role` is noted in
the design doc, not taken here.

## Tests

- Unit: `admin-sections` (visible sections in order, `/admin` landing, none for
  `post` only, distinct paths); `roleKeyFromName` (hyphenation, refusals, cap,
  system key facts). `pnpm turbo run typecheck lint test`: 23 tasks green
  (identity 47, web 67, core 33, timetable 56, adapter 12).
- Integration (identity suite, runs in CI against the split database): member
  list carries roles and is shut without `manage-members`; suspension removes
  every permission and reinstatement restores them, idempotently; refuses self,
  the unpermitted, the last administrator, and an unknown member; a tenant's own
  role is created, deduplicated, refused as `exists` / `bad_name`, and its
  permissions replaced with the change visible to a holder at once; system roles
  and unknown roles refused; a student cannot define roles; one tenant's roles
  never reach another; **a custom role holding `approve-verifications` can list
  and decide the queue and nothing more**, while a student cannot. The existing
  member list assertion follows the field rename (`roles: ['student']`).
- e2e: the admin 404 test now also covers `/admin/members`, `/admin/roles`, and
  the three new mutation routes. `pnpm --filter web test:e2e`: 64 passed
  against a production build; `pnpm --filter web build` clean.
- Browser (local dev server, a minted administrator session): `/admin` forwards
  to the queue and the nav lists all five sections; on Members, granting
  Teacher adds the chip, suspending flips the badge to Suspended and the button
  to Reinstate, reinstating and revoking put it back, each with "Saved."; on
  Roles, the three built in cards render read only and creating "Registrar"
  with "Approve verification requests" yields the new card and its key; the
  account page's admin link points at `/admin/verification`.

## Verification steps

1. Sign in as a configured admin; `/admin` lands on the verification queue and
   the nav shows all five sections.
2. `/admin/members`: add "Teacher" to a member and the chip appears; remove it
   and it goes; suspend them, sign in as them, and `/admin` and `/account`'s
   admin link are gone; reinstate.
3. `/admin/roles`: create "Registrar" with "Approve verification requests";
   grant it to a member; as that member `/admin/verification` opens and
   `/admin/members` is 404.
4. Signed out or as a plain member, every path in the table above is 404.

## Follow-ups

- Drop `tenant_memberships.role` (design doc §2).
- The member list is capped at 200 with no paging; fine for one university,
  not for a large one.
- A role of the tenant's own cannot be deleted yet, only emptied of permissions
  and revoked from everyone.
- Phase 3 (activity timing analytics) is next; it adds `last_login_at` /
  `last_active_at` and nothing about where anyone is.
