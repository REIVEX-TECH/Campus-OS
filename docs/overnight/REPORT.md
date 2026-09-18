# Overnight run 5 — morning report

A demo tenant, `demo`, served at `demo.campusos.reivex.io`: a fictional "CampusOS Demo
University" with seeded, illustrative content across every enabled module — a showcase
for prospects and a staging surface. It carries the required banner, and real signed-in
users are read-only on it (enforced server-side). **Nothing about LGU changes** — every
demo-specific field is additive and defaults off.

Design first (`docs/design-demo-tenant.md`), then four PRs, each branched off `main`,
CI-green before merge. Non-obvious calls are in `DECISIONS.md` (Run 5). No production
change: no migration run against prod, no deploy, no tenant flag flipped; the demo
reaches a database only when a human runs `pnpm demo:seed`.

Run 4's report is in git history; this supersedes it.

---

## 1. What shipped

§6 = a concrete-SQL adversarial review applied.

| PR   | What                                                                                                                                          | §6      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| #232 | Foundation: `isDemo`/`notice` on the tenant config, the `demo` tenant, the notice banner, `users.is_demo` (identity 0034) + `Actor` threading | **yes** |
| #233 | `pnpm demo:seed` — personas + verified memberships + content across timetable, communities, lost-found, marketplace, messages, rides          | no      |
| #234 | Read-only rule (H): `demoReadOnly` wired into every mutation gate + a boundary test                                                           | **yes** |
| #235 | `pnpm demo:reset` (wipe + re-seed) + `docs/runbooks/demo-tenant.md` (deploy notes)                                                            | no      |

### A. Tenant + branding

`tenants/demo/tenant.config.ts`: fictional "CampusOS Demo University", a blue accent,
closed join (`invite`, no domains), every UI module enabled (`campus-map` stays soon),
`isDemo: true`, and the banner `notice`. The wildcard `*.campusos.reivex.io` already
resolves the host — zero infra change.

### B/C. Seed users + content

8 personas (`users.is_demo = true`) with verified `demo` memberships, and content across
every module: a full timetable (campus/buildings/rooms/term/dept/program/4 courses/2
teachers/2 sections/6 weekly entries), 2 communities with posts/comments/votes/karma, 4
lost-and-found items, 5 marketplace listings + a gig with packages + a completed order and
review, 2 message threads, and 3 rides with an accepted seat and a rating. Owner-run and
idempotent (`ON CONFLICT DO NOTHING` on deterministic ids).

### D. Guardrails

- **G — banner**: a `notice` field on the tenant config renders a top banner on every
  tenant page when set; the demo config sets it to the required copy, and it reaches the
  DB through `pnpm demo:seed` / `pnpm tenants:sync` (the seed/migration path, never a hand
  edit).
- **H — read-only for real users**: `demoReadOnly(tenant, actor)` returns a 403 when
  `tenant.isDemo && !actor.isDemo`, wired into every mutation gate (communities,
  lost-found, marketplace goods + services, rides, messages). Reads are untouched. A
  boundary test proves a real user cannot mutate on demo while a persona can, and LGU is
  unaffected. "No messaging seeded users" falls out of the same rule.
- **Closed join** and **no LGU change** round out the guardrails.

### E/F. Reset + deploy

`pnpm demo:reset` wipes demo content and re-seeds to a known state (scoped to `demo`
only). `docs/runbooks/demo-tenant.md` documents the host (wildcard, no infra),
seed/reset, the banner path, and optional `-- --tenant demo` maintenance crons.

---

## 2. Standing the demo up (NOT run against prod)

```bash
pnpm db:migrate:all   # applies identity 0034 (users.is_demo)
pnpm demo:seed        # tenant + config (banner) + roles + content, idempotent
```

Reset any time with `pnpm demo:reset`. The host `demo.campusos.reivex.io` needs no DNS/
cert/nginx/env change (existing wildcard). First tenant admin, if wanted, is granted via a
platform grant at `/u/demo/admin/roles` (the demo already seeds a `tenant_admin` persona
for display).

## 3. Security (CLAUDE.md 6, 8)

- The H decision keys on two values a real user cannot forge: `tenant.isDemo` (tenant
  config, platform-admin-write) and `actor.is_demo` (the user's own row, which a
  RESTRICTIVE policy `TO campusos_app` — identity 0034 — stops the app role from ever
  setting true; only the owner seed sets it). Enforced at the API gate, so hitting the API
  directly does not get around it; independent of verification, so the demo is read-only
  by construction.
- No new SECURITY DEFINER. Personas carry a fake `google_sub` no real sign-in can match.

## 4. Verification

Every PR: CI green across typecheck/lint/format/build/test, integration (Postgres + RLS),
and e2e (one known timetable-combobox flake on #234 cleared on re-run). The seed and reset
are owner-run tooling CI does not execute, so both were verified locally against real
Postgres: `demo:seed` is idempotent and populates every module; `demo:reset` returns the
tenant to its exact seeded counts.

## 5. Follow-ups

- A demo logo asset at `/tenants/demo/logo.svg` (referenced, not committed — as with LGU).
- `membership_roles` for the seeded personas if the demo ever needs live RBAC surfaces
  (skipped: personas never sign in, and content displays by handle, not role).
- Photos on demo lost-found / marketplace listings once an ObjectStore is wired for demo.
