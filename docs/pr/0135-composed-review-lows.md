# chore(identity): composed-review Lows + M2 bridge guard

The Low findings from the composed §6 review, plus the bridge guard for M2's
residual, in one pass. No migration, no behaviour change to a shipped flow.

## Changes

- **L1 — `rbac.ts`.** `rolesForMember` now gates in the function on `manage-roles`
  OR `manage-members` (returns empty otherwise), so a specific member's role
  assignments are not readable off tenant-context RLS alone. `listRoles` is left
  ungated **on purpose**, now documented: it is a non-sensitive, tenant-scoped
  catalogue (a materialisation of platform templates) read legitimately by a
  resident admin with either permission AND by a platform admin verifying a
  definition reached a tenant — a per-permission gate would wrongly hide it from
  those callers (the reviewer's "no app caller" premise was incorrect; both admin
  pages call it, under different permissions).
- **L2 — isolation FORCE-invariant map.** Added the tables it omitted:
  `verify_prompt_dismissed` (FORCE, own-row), `role_templates` /
  `role_template_permissions` (NO FORCE, public read). The guardrail now watches
  every RLS table in the module.
- **L3 — `membership.ts` docstring.** Dropped the retired `grantVerified` / "the
  configured admin list at sign in" description; writes go through the 0019
  definers.
- **L4 — `platform.ts` comment.** Dropped the "in the same way a tenant's
  configured admins work" reference (that mechanism is gone).
- **L5 — `membership.ts` `VerificationMethod`.** Kept `'config'` (existing rows may
  still carry it) but annotated it as historical — no live writer emits it since
  0025/0028.
- **Info — `scripts/db-grants.sql`.** Added the load-bearing comment on the
  `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS` block: it makes
  app-EXECUTE the default for future functions, so an owner-only definer must
  REVOKE from `campusos_app` by name (the `DEFINER_INTENT` test enforces this).
- **M2 bridge — `apps/web/test/standing-columns-gated.test.ts` (new).** A static
  scan asserting only the known gated readers (`standing.ts`, the schema, the
  own-standing notice + layout) reference `standing_reason` / `appeal_note`, so no
  new un-gated reader can appear before M2 moves them to a side table. Update its
  allowlist (or delete it) when M2 lands.

## Tests

- New: `rolesForMember` returns empty for a non-admin (isolation suite).
- New: the M2 bridge scan.
- Extended: the FORCE-invariant map.

```bash
pnpm -C apps/web exec vitest run test/standing-columns-gated.test.ts
pnpm -C apps/web exec vitest run test/no-configured-admins.test.ts
pnpm -C packages/modules/identity test:integration   # FORCE map + rolesForMember gate
```

Bridge test, no-configured-admins regression, typecheck and prettier verified
locally; the isolation suite runs in CI.

## Follow-ups

- **M2** (awaiting scope confirmation): move `standing_reason` / `appeal_note` to
  an own-row side table (the M1 shape); this bridge guards the residual until then.
- The doc rewrite (`design-platform-admin.md` + `platform-admin-status.md`).
