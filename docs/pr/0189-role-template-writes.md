# fix(identity): move role-definition writes behind a platform-admin stamp

Block A item 5 (security backlog M3). Role definitions (`role_templates`,
`role_template_permissions`) were writable under PERMISSIVE RLS policies keyed on
`EXISTS (platform_roles WHERE user_id = current_setting('app.user_id'))` — a
PRIVILEGE decision keyed on a GUC the application sets and can re-set
mid-transaction (CLAUDE.md 8). Anything able to set `app.user_id` to a platform
admin's id could then rewrite what every role carries, in every tenant. This
closes that the 0016/0018 way: the write leaves the app role's hands and is gated
on an unforgeable per-transaction stamp.

## What

- **`platform_admin_uses`** (migration `0033`): one row per platform-host
  transaction, stamped `pg_current_xact_id()` (`xid8`). RLS on, no policy, and its
  writes revoked from `campusos_app` by name in a split database — the app reaches
  it only through the definers below.
- **`auth_begin_platform_admin()`** — verifies the caller is a platform admin
  (`platform_roles`, unwritable by the app since 0016) AND is not acting under a
  tenant grant (`auth_under_tenant_grant()`, the unforgeable use-row), then stamps
  the current txid. Called once at the top of each write path.
- **`auth_platform_admin_for_txn()`** — the admin who stamped THIS transaction, or
  NULL. A definer over `platform_admin_uses`, which the app cannot read.
- **Three write definers** — `auth_write_role_template`,
  `auth_set_role_template_permissions`, `auth_delete_role_template` — each gated on
  `auth_platform_admin_for_txn() IS NOT NULL`, each writing an `audit_log` line in
  the same statement. They keep the existing result contract
  (`exists` / `no_such_template` / `unchanged` / `changed` / `system_template` /
  `deleted`), so `role-templates.ts` behaves identically to callers.
- **The GUC-keyed policies are dropped**: the 0013 platform-insert/update/delete
  policies (and the 0013 restrictive update-check) and the 0018 under-grant
  subtractions on both tables. With no write policy left, RLS default-denies every
  app write; the 0013 table-level `INSERT/UPDATE/DELETE` grant is also revoked from
  the app role by name in a split DB, so no future permissive policy can silently
  re-open it.
- **`role-templates.ts`** — `createRoleTemplate` / `setRoleTemplatePermissions` /
  `deleteRoleTemplate` keep their app-side `isPlatformAdmin` early-check, then call
  `auth_begin_platform_admin()` and the matching definer inside the actor's
  transaction, re-syncing every tenant after a change (unchanged behaviour).

## Data & migration impact

New table `platform_admin_uses` and five functions (`0033`, identity module).
Additive; drops only write policies that are replaced by the definers. Reads are
unchanged (definitions stay public). Backwards-compatible: existing definitions and
their permissions are untouched. Rollback = drop the table and functions and
re-create the 0013/0018 write policies.

## Security review (CLAUDE.md 6, 8)

- **Containment keyed on an unforgeable row.** "No grant visitor may edit the
  global catalogue" is enforced by `auth_begin_platform_admin()` raising when
  `auth_under_tenant_grant()` is true — the same txid use-row 0018 uses, not a GUC.
  This replaces the dropped `role_templates_not_under_grant` subtractions with the
  identical guarantee.
- **The write gate is a per-transaction stamp**, so a stray injected write in a
  transaction that merely happens to carry an admin `app.user_id` (for a read)
  matches no policy and cannot write without a deliberate `auth_begin_platform_admin`
  call. The stamp is in a table the app cannot read, forge, or carry across
  transactions.
- **The base identity check reads `app.user_id` → `platform_roles`.** That is the
  session-identity trust the whole system already rests on — identical to
  `auth_grant_platform_admin` (0016) and `auth_open_tenant_grant` (0018) — not the
  forbidden containment-on-a-GUC. `platform_roles` itself is unwritable by the app
  (0016), so the check cannot be satisfied by writing oneself a row.
- **FORCE:** the definers write as the table owner; `role_templates` /
  `role_template_permissions` are `NO FORCE` (0013, so `auth_sync_tenant_roles`
  reads them), and `platform_admin_uses` is `NO FORCE` for the same reason — pinned
  in the identity FORCE-invariants test.
- **Least privilege / grants:** the five definers are `REVOKE ALL FROM PUBLIC` then
  `GRANT EXECUTE ... TO campusos_app`, matching 0018's resolver-granting pattern;
  all are declared `'app'` in the DEFINER_INTENT audit.

## Tests

- The communities integration definer audit registers the five new definers and
  asserts each is app-executable (its intent).
- The identity FORCE-invariants test pins `platform_admin_uses` as `NO FORCE`.
- The identity isolation suite already drives the full role-template lifecycle
  through a real platform admin (`createRoleTemplate` / `setRoleTemplatePermissions`
  / `deleteRoleTemplate`, plus the not-allowed / exists / system_template /
  no_such_template refusals); those now exercise the definer path unchanged.
- Identity + communities + web typecheck and lint pass locally; the split
  integration suite (definer audit, FORCE invariants) runs in CI.

## Follow-ups

Nothing new enabled for any tenant. A5 completes Block A's security backlog; A6
(backup freshness check) is next.
