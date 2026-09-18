# feat(demo): demo tenant foundation — markers, config, and notice banner

Run 5, PR 1 of the demo-tenant build. The foundation the rest sits on: the two demo
markers, the `demo` tenant config, and the notice banner. **Nothing about LGU changes**
— every new field is additive and defaults off.

Design: `docs/design-demo-tenant.md` (added here).

## What

- `packages/core/src/tenant/schema.ts` — two optional, defaulted fields on
  `tenantConfigSchema`: `isDemo` (boolean, default false — scopes the read-only rule
  and the seed to the demo tenant) and `notice` (optional string — a site-wide banner).
  LGU omits both and validates/behaves exactly as before.
- `tenants/demo/tenant.config.ts` + `tenants/index.ts` — the `demo` tenant: fictional
  "CampusOS Demo University", closed join (`invite`, no allowed domains), every UI
  module enabled, a blue accent, `isDemo: true`, and the required `notice` copy. Added
  to `fileTenantConfigs`; the wildcard host already resolves `demo.campusos.reivex.io`.
- `packages/modules/identity/drizzle/0034_users_is_demo.sql` + schema — `users.is_demo`
  (boolean, default false), the persona/fixture marker, with a RESTRICTIVE RLS policy
  scoped to `campusos_app` that forbids the app from ever writing `is_demo = true`
  (only the owner-run seed sets it). Threaded into `Actor` via `resolveSession` /
  `findOrCreateUser`.
- `apps/web/app/_components/tenant-notice.tsx` + `u/[slug]/layout.tsx` — renders the
  tenant's `notice` as a top banner when present; LGU (no notice) keeps the exact same
  DOM (the wrapper is added only when a notice or a standing notice exists).

## Data & migration impact

Identity migration `0034_users_is_demo` adds a defaulted boolean column (backwards
compatible; existing inserts omit it) and, in a split DB, a RESTRICTIVE policy. The two
tenant-config fields are additive with defaults. No tenant flag flipped in the DB;
`demo` reaches the DB only when a human runs `pnpm tenants:sync` / the demo seed (PR 2).

## Security review (CLAUDE.md 6, 8)

- **`is_demo` is the authorization input for the demo read-only rule (H), so it must
  not be app-writable (§8).** `own_user` (0001) would let a user write their own row;
  a column-level revoke would not survive db-grants' blanket table grant. So a
  RESTRICTIVE policy `TO campusos_app` blocks the app role from writing `is_demo = true`
  on insert or update — only the owner (the seed) sets it. It is a policy, not a grant,
  so it is independent of db-grants and survives re-application; skipped on an unsplit
  dev DB where the guarantee cannot hold. The rule's other input, `tenant.isDemo`, comes
  from `tenant_configs` (platform-admin-write, definer-guarded) and is likewise not
  user-forgeable.
- No new definer. `users` keeps ENABLE + FORCE and its `own_user` policy; the addition
  is one RESTRICTIVE policy that only tightens the app's write.

## Tests / verification

`turbo run typecheck lint` passes for core, identity, tenants, and web; the core tenant
suite (13) and the full web vitest suite (129, incl. no-dash + migration-journal-parity
picking up `0034`) pass; migrations apply cleanly locally. The identity RLS behavior of
the new policy runs in CI (the identity integration suite is split-only).

## Follow-ups (this run)

PR 2 — the demo seed (`pnpm demo:seed`): personas, memberships, and content across every
enabled module. PR 3 — the read-only enforcement (H) at every mutation gate + boundary
tests. PR 4 — the reset script (E) and the runbook / deploy notes (F).
