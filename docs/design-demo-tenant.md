# Demo tenant — design

A second tenant, `demo`, served at `demo.campusos.reivex.io`, with seeded realistic
content across every enabled module: a showcase for prospects and a staging surface.
**Nothing about `lgu` changes.** Everything demo-specific is additive and defaulted
off, so `lgu` (and any future tenant) is untouched.

## Decisions (locked)

- **Two markers, two questions.** `users.is_demo` (boolean, default false) answers "is
  this account a seeded persona?" — it lives on the platform-level account because the
  same real Google account gets an ordinary membership on any tenant, so a membership
  row cannot tell a persona from a visitor. A tenant-level **`isDemo`** (new optional
  field on `tenantConfigSchema`, default false) answers "is this the tenant where the
  read-only rule fires?" Both are cheap in every gate: the gate already resolves the
  full `TenantConfig` (has `isDemo`), and `actor.isDemo` is threaded through
  `resolveSession`/`findOrCreateUser` at no extra query.
- **Read-only is explicit, not a side effect of verification (H).** Real signed-in
  users on `demo` are unverified anyway (closed join), so `isVerifiedMember` already
  blocks most writes — but the guardrail must hold even if a real user were somehow
  verified. So the rule is enforced directly: `tenant.isDemo && !actor.isDemo → 403`,
  in every mutation gate. Personas (the seeded content's authors) are `is_demo` and are
  never the actor of a live request (they are fixtures), so real demo usage is
  read-only by construction; mutations happen only through the owner-run seed/reset.
- **Additive schema only.** `isDemo?` and `notice?` on `tenantConfigSchema` are
  optional with defaults; `users.is_demo` defaults false. `lgu`'s file config and DB
  row omit all three and validate/behave exactly as before. No LGU file, row, DNS, or
  cron line changes.
- **Closed join.** `joinMode: 'invite'`, `allowedEmailDomains: []` — no real visitor
  auto-verifies into demo. A real Google sign-in still yields an unverified student
  membership (so they can browse as a signed-in user), but writes are refused by H.
- **Seeded, fictional identities.** The tenant is a fictional "CampusOS Demo
  University" — it impersonates no real institution. Personas have fictional names,
  handles, and `@demo.campusos.reivex.io` emails. All content is illustrative (the
  banner says so).

## A. Tenant + branding

`tenants/demo/tenant.config.ts` (added to `fileTenantConfigs` in `tenants/index.ts`):
`slug: 'demo'`, `displayName: 'CampusOS Demo University'`, `timezone: 'Asia/Karachi'`,
`locale: 'en'`, distinct branding colours (a blue, to read differently from LGU's
green), `logoPath: '/tenants/demo/logo.svg'` (asset optional, as with LGU),
`joinMode: 'invite'`, `allowedEmailDomains: []`,
`enabledModules: ['timetable','communities','lost-found','messages','marketplace','rides']`
(every module with a UI; `campus-map` stays soon), `isDemo: true`, `notice: <G copy>`,
`seo`. The wildcard `*.campusos.reivex.io` DNS + cert + nginx already resolve the host
(§F) — zero infra change.

## B. Seed users

~12 personas inserted into `users` with `is_demo = true` (under `withActor(personaId)`
so the `own_user` RLS insert passes; deterministic ids from a fixed namespace so the
seed is idempotent). Each gets a verified `tenant_memberships` row on `demo` (owner
insert — the table is NO FORCE since identity 0010; `verified_at` set,
`verification_method = 'config'`), roles a mix of `student` + a couple `teacher` + one
`tenant_admin` persona. `public_profiles` is a view over `users`, so handles/avatars
surface automatically. `auth_sync_tenant_roles('demo')` is run first (the file/CLI path
does not call it — survey confirmed).

## C. Seed content (every enabled module)

Owner-run, idempotent (stable ids, `on conflict do nothing`), setting `app.tenant_id`
(+ `app.user_id` where a FORCE table's insert-as-self policy needs it) so FORCE tables
accept the writes. We insert end-state rows directly rather than driving each module's
API (simpler, and avoids the verified-gate/contact-scrub which is not the seed's
concern):

- **timetable**: a campus, 2-3 buildings, rooms, an academic term, a department, a
  program, ~6 courses, ~5 teachers, ~8 sections, and their weekly `timetable_entries`.
- **communities**: 2 communities, ~8 posts, ~15 comments, votes/karma.
- **lost-found**: ~6 items (lost/found, a couple resolved). No photos (ObjectStore not
  wired for demo; text-only is realistic enough).
- **marketplace**: ~8 goods listings, 2 gigs, 1 completed order + review.
- **messages**: 3 conversations between personas with a few messages each.
- **rides**: ~5 ride posts (offers + a request), a couple accepted seats, 1-2 ratings.

## D. Guardrails

- **G — banner**: `notice` on the tenant config renders a top banner on every tenant
  page when set; demo sets it to the required copy. Set via the config file →
  `pnpm tenants:sync` (the seed/migration path), never by hand.
- **H — read-only for real users**: `assertDemoWritable(tenant, actor)` in a shared lib,
  called from every mutation gate (communities, lost-found, marketplace goods +
  services, rides, messages); returns a 403 when `tenant.isDemo && !actor.isDemo`.
  Reads are untouched (read gates and read paths do not call it). Boundary test proves
  a real (non-demo) member cannot mutate on demo while a persona can, and that LGU is
  unaffected.
- **Closed join** (above) and **no LGU change** are guardrails too.

## E. Reset script

`pnpm demo:reset` (owner-run, idempotent): delete every `tenant_id = 'demo'` content
row across the module tables and the demo memberships + `is_demo` users, then re-run the
seed. Safe to run repeatedly; refuses to touch any tenant but `demo`.

## F. Deploy notes

`docs/runbooks/demo-tenant.md`: the host resolves through the existing wildcard (no DNS/
nginx/env change); `pnpm tenants:sync` writes the config row (carrying the banner);
`pnpm demo:seed` / `pnpm demo:reset` populate it; and the per-module maintenance crons
(`rides:sweep`, `lostfound:expire`, `marketplace:expire`, `messages:cleanup`,
`communities:archive`) get `-- --tenant demo` lines.

## PR sequence

1. **Foundation** — `isDemo`/`notice` on `tenantConfigSchema`; the `demo` tenant config
   - banner render; `users.is_demo` migration + `Actor` threading. §6 the users column/RLS.
2. **Seed** — `pnpm demo:seed` (personas, memberships, content across all modules).
3. **Read-only (H)** — `assertDemoWritable` wired into every mutation gate + boundary tests. §6.
4. **Reset + deploy (E, F)** — `pnpm demo:reset` + the runbook.
