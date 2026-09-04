# CLAUDE.md

Standing instructions for any AI coding agent working in this repository.
Read this file in full before making any change. These rules override convenience.

---

## 1. What this project is

A multi-tenant, open-source campus platform. A "tenant" is a university.
The first tenant is Lahore Garrison University (`lgu`), but **no LGU-specific
logic may ever live in core packages**. If a rule is true only for LGU, it goes
in a tenant config file or a tenant adapter package — never in shared code.

The first module is Timetable. Other planned modules: identity/verification,
communities, postings, lost & found, marketplace, ride-sharing, campus map,
teacher tools, course catalogue.

Design target: a third party should be able to add a new university, or a new
feature module, without editing core code.

---

## 2. Non-negotiables

1. **No paid services, no paid tiers required.** Every dependency and hosted
   service must have a free tier sufficient for production, or a self-hosted
   equivalent. If you propose a service, state its free-tier limits and the
   self-hosted fallback.
2. **No vendor lock-in.** All external services (email, storage, cache, error
   reporting, auth provider) sit behind an interface in `packages/core`. Never
   import a vendor SDK directly from application code.
3. **Never hardcode a tenant.** No `if (tenant === 'lgu')` in core. Ever.
4. **Never commit secrets.** `.env.example` documents every variable; `.env` is
   git-ignored. Any key found in the source of the upstream crawler is treated
   as compromised and rotated.
5. **Licence discipline.** Runtime dependencies must be MIT / Apache-2.0 / BSD /
   ISC. Weak-copyleft (e.g. MPL-2.0) is permitted **only** for build/dev tooling
   that is not distributed with the product (e.g. Turborepo). Flag anything GPL,
   AGPL, SSPL, BUSL, or source-available before adding it.
6. **No AI attribution in git history.** See §7.

---

## 3. Response protocol — required on EVERY response

Structure every reply in this order. Do not skip sections; write "n/a" if empty.

**1. Plan** — numbered steps, before touching any file. For anything beyond a
trivial edit, stop after the plan and wait for approval.

**2. Assumptions & open questions** — anything you had to guess. If a decision
is architectural and reversible only at high cost, ask instead of assuming.

**3. Changes** — grouped by file path, each with a one-line rationale.

**4. Data & migration impact** — schema changes, migration file name, whether
it is backwards-compatible, and the rollback path. Write "no schema change" if
none.

**5. Tests** — what you added or updated, and the exact command to run them.
If you did not add tests, say so and justify it.

**6. Verification steps** — the literal commands and URLs a human uses to
confirm the change works.

**7. Follow-ups** — known gaps, TODOs, tech debt introduced. Be honest here;
silently leaving debt is worse than naming it.

Additional rules for every response:

- Prefer reading existing code over inventing new patterns. Search first.
- Never claim something works if you did not run it. Say "untested" plainly.
- If a request conflicts with this file, say so and propose an alternative
  rather than quietly following the request.
- Keep prose short. No filler, no restating the request back.

---

## 4. Architecture rules

### Layout

```
apps/web            Next.js app (App Router)
apps/docs           documentation site
packages/core       domain types, interfaces, module registry, result types
packages/db         Drizzle schema, migrations, seed scripts
packages/ui         design system (Tailwind + shadcn/ui)
packages/config     eslint / tsconfig / tailwind shared configs
packages/modules/*  one package per feature module
packages/adapters/* one package per data source (e.g. timetable-lgu)
tenants/*           per-tenant config, branding, SEO, module toggles
```

### Dependency direction

`apps → modules → core → db`. Never the reverse. Modules must not import from
each other; they communicate through core interfaces and events. Two modules
that need each other's data is a signal that something belongs in core.

### Module manifest

Every module package default-exports a manifest:

```ts
{
  (id,
    version,
    routes,
    navigation,
    permissions,
    settingsSchema,
    migrations,
    jobs,
    apiRoutes,
    eventHandlers);
}
```

Core discovers and mounts modules from the registry. A tenant enables modules
in its config. A disabled module must contribute zero routes, zero nav items,
and zero queries.

### Multi-tenancy

- Single database, shared schema, `tenant_id` on every tenant-scoped table.
- Postgres Row-Level Security is the enforcement boundary. Application-level
  filtering is a convenience, never the security guarantee.
- Every query goes through a repository that sets the tenant context. No raw
  `db.select()` from route handlers.
- Tenant resolution happens once, in middleware, and is passed down explicitly.
- A tenant's `slug` is its permanent, immutable identity: it is the `tenant_id`
  on every scoped row and the RLS key. Slugs are never changed; display names
  and all other tenant fields are mutable.

### Data ingestion (crawlers, imports)

- Adapters implement a shared interface: `fetchRaw → normalize → diff → upsert`.
- Adapters are pure with respect to the database: they emit normalised records,
  the pipeline persists them. Never let an adapter write to the DB directly.
- Every run writes an `ingestion_runs` row: started, finished, counts, errors.
- Never destructively overwrite. Use `valid_from` / `valid_to` versioning so
  schedule changes are detectable and reportable to users.
- Scrapers must be polite: respect rate limits, set a real User-Agent with a
  contact URL, back off on errors, and cache aggressively.

---

## 5. Code standards

- TypeScript strict mode. `any` requires an inline comment justifying it.
- Validate every external input with zod at the boundary — request bodies,
  query params, env vars, scraper output, third-party API responses.
- Errors: typed `Result<T, E>` for expected failures; exceptions only for bugs.
  Never swallow an error. Never log secrets or full user records.
- Server Components by default; `"use client"` only where interaction requires
  it, and as deep in the tree as possible.
- All user-facing strings go through the i18n layer. No hardcoded English in
  components.
- Accessibility is not optional: semantic HTML, keyboard reachable, visible
  focus, WCAG AA contrast, labelled form controls. Timetables must be readable
  by screen readers, not just visually.
- Time: absolute instants (created_at, ingestion timestamps, OTP expiry, …) are
  stored in UTC; never rely on the server's local time. Recurring events such as
  weekly class slots are stored as local wall-clock time plus an ISO-8601
  day-of-week, interpreted through the tenant's timezone when materialised into
  concrete instants (e.g. ICS feeds) — this is correct across DST, where a fixed
  UTC instant would drift. Academic weekdays are ISO-8601 numbers (1 = Monday).
- Files stay under ~300 lines. Functions do one thing.

---

## 6. Testing & quality gates

- Unit tests (Vitest) for all domain logic, normalisers, and diffing.
- Integration tests for repositories against a real Postgres in Docker.
- E2E (Playwright) for the critical paths: view a timetable, sign in, verify
  university email, subscribe to a calendar feed.
- Every bug fix starts with a failing test.
- CI must pass before merge: typecheck, lint, format, unit, integration, build.
- Performance budget for public pages: LCP under 2.5s on a 3G profile,
  no client bundle over 200KB gzipped per route.
- **Security SQL is reviewed against the concrete SQL, not the design.** RLS
  policies, `SECURITY DEFINER` functions, and anything that gates a privileged
  write get an adversarial pass over the migration as written, not over the
  plan. This is not optional caution: in Phase 5 two distinct escalations
  (keying containment on `app.grant_use`, then on `app.user_id`) both passed a
  design review and were only caught reviewing the implementation. A design
  review of security SQL is necessary but never sufficient.

---

## 7. Git & collaboration

- **Do not add `Co-Authored-By` trailers, "Generated with" lines, emoji
  signatures, or any AI attribution to commits, PR descriptions, or code
  comments.** This project is presented as human-authored open source.
  Ensure `.claude/settings.json` contains `"includeCoAuthoredBy": false`.
- Conventional Commits: `feat(timetable): add ICS feed for sections`.
  Scope is the module or package name.
- Branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Never commit to `main`.
- One logical change per commit. No "misc fixes" commits.
- PR description covers: what, why, how to test, screenshots for UI, migration
  notes, breaking changes.
- Every feature branch includes a ready-to-paste PR body at
  `docs/pr/NNNN-<slug>.md`, written from the branch's actual content before
  handing over for review.
- Update `README`, `docs/`, and `.env.example` in the same PR as the code.

---

## 8. Security & privacy

- Student data is sensitive. Collect the minimum; justify every field.
- Rate-limit every public endpoint and every auth flow.
- University email verification uses time-limited, single-use, hashed OTPs.
- Authorisation is checked server-side on every request. Hiding a UI element
  is not access control.
- **An authorisation decision keyed on a value the application can write is not
  an authorisation decision.** `app.user_id`, `app.tenant_id`, and every other
  `current_setting('app.*')` GUC are set by the application and can be re-set
  mid-transaction, so a policy or `SECURITY DEFINER` that compares against one
  is forgeable. Tenant ISOLATION may key on `app.tenant_id` (that is its job);
  any decision about PRIVILEGE — who may write this row, whether this action is
  permitted — must key on a row the application cannot forge (e.g. a use-row
  stamped with `pg_current_xact_id()`, read through a definer over a table the
  app has no write on), never on a GUC. This constrains every module. The Phase
  5 grant core (`packages/modules/identity/drizzle/0018_tenant_grants.sql`) is
  the worked example; two successive designs were broken on exactly this.
- A table that must not be written by the application gets its writes revoked
  from the app role by name and routed through an audited definer — a bare
  `REVOKE ... FROM PUBLIC` does not remove the EXECUTE the owner's default
  privileges grant, and RLS with a permissive tenant policy still admits a
  self-write. See `platform_roles` (0016) and the membership tables.
- No PII in URLs, logs, or analytics events.
- Threat-model any user-to-user feature (marketplace, ride-sharing, messaging)
  before building it: reporting, blocking, and a moderation queue ship in the
  same release as the feature, not later.

---

## 9. When you are unsure

Ask. A five-line question is cheaper than a wrong abstraction that three
modules get built on top of.
