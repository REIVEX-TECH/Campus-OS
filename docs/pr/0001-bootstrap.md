# feat: bootstrap the Campus OS monorepo (scaffold → multi-tenancy → timetable → LGU ingestion)

## What

Stands up the whole foundation on `feat/bootstrap`:

- **Scaffold** — pnpm + Turborepo workspace; shared eslint (flat) / prettier /
  tsconfig in `packages/config`; `apps/web` (Next 15 App Router, TS strict,
  Tailwind v4, shadcn/ui); CI, Husky + lint-staged + commitlint; governance docs;
  `docker-compose.yml` (Postgres 18) + `scripts/db-bootstrap.sql`.
- **Multi-tenancy** — file-based tenant config + registry (`@campusos/core/tenant`,
  `@campusos/tenants`, first tenant `lgu`); `@campusos/db` with `tenant_id` (=
  slug) on every scoped table, **FORCE ROW LEVEL SECURITY**, a per-transaction
  tenant-context helper, and tenant-bound repositories; web middleware that
  resolves the tenant by subdomain (`/u/{slug}` fallback), per-tenant
  `generateMetadata` / `robots.txt` / `sitemap.xml`, and an ESLint rule + test
  banning raw db-client imports in app code.
- **Timetable module** — canonical schema (terms, departments, programs,
  sections, courses, teachers, versioned `timetable_entries`, `ingestion_runs`,
  `source_snapshots`, subscriptions, `unmapped_source_values`); pure domain
  (content hashing, diff/versioning, conflict detection, free rooms);
  repositories; module manifest + module-owned RLS migrations.
- **Ingestion** — generic pipeline in core (`TimetableSource`, `IngestionSink`,
  `runIngestion`); the timetable sink; a **clean-room** LGU adapter (session
  bootstrap → env fallback → loud abort, bounded async queue, fixture/live
  modes); `pnpm ingest:lgu`; a disabled scheduled workflow.

## Why

Everything downstream (identity, communities, more modules and tenants) needs a
tenant-isolated data layer, a module system, and an ingestion path that a third
party can extend without touching core. This PR establishes those with the
architecture rules in `CLAUDE.md` enforced (dependency direction, RLS as the
isolation boundary, adapters pure w.r.t. the DB, no hardcoded tenant in core).

## How to test

```bash
corepack enable && pnpm install
```

All gates (no DB needed):

```bash
pnpm turbo run typecheck lint format:check build test   # 22/22 green
```

DB-backed checks (Postgres 16+; run the bootstrap once as a superuser):

```bash
# native (adjust the psql path) or: docker compose up -d
psql -U postgres -h localhost -f scripts/db-bootstrap.sql
cp .env.example .env
pnpm db:migrate:all && pnpm db:seed
pnpm --filter @campusos/db test:integration            # cross-tenant isolation, incl. forged-filter + WITH CHECK
SOURCE_MODE=fixture pnpm ingest:lgu                     # inserted=4 …
SOURCE_MODE=fixture pnpm ingest:lgu                     # …then inserted=0 closed=0 (idempotent)
```

App:

```bash
pnpm --filter web dev
```

- `http://localhost:3000/u/lgu` → LGU; `http://localhost:3000/u/unknown` → 404
- `http://lgu.localhost:3000` → LGU via subdomain
- `/robots.txt` and `/sitemap.xml` are tenant-driven

**Verified locally:** gates 22/22; isolation suite 4/4 (RLS blocks cross-tenant
reads, forged `tenant_id` filters, and cross-tenant inserts; default-deny with no
context); ingest idempotent (run 1 inserted 4, run 2 inserted 0); two
`ingestion_runs` rows, both `success`, with unknown source values recorded (never
dropped) and new dimensions created `pending` for review.

## Migration notes

Greenfield; backwards-compatible (all additive). Order: base `@campusos/db`
migrations, then module migrations (`pnpm db:migrate:all` handles this). Base:
`0000_init` (universities/campuses/buildings/rooms), `0001_rls`. Timetable:
`0000_timetable`, `0001_timetable_rls`. Every tenant-scoped table has
`ENABLE`+`FORCE ROW LEVEL SECURITY` with a default-deny `tenant_isolation`
policy. Rollback = drop policies + tables (no data at risk on a fresh DB). The
app connects as the least-privilege `campusos_app`; a superuser would bypass RLS,
so it must never be used for the app.

## Screenshots

Placeholder UI only (tenant landing + 404); no design work in this PR.

## Breaking changes

None — initial bootstrap.

## Follow-ups

- Admin UI to review/resolve `unmapped_source_values`.
- Emit `timetable.entry.changed` from the sink → wire `change_subscriptions`
  notifications.
- Split migration vs runtime DB roles for production.
- Confirm the LGU wire shapes against recorded fixtures and reconcile
  `schemas.ts` / `normalize.ts` (see `docs/recording-fixtures.md`); enable the
  scheduled ingest workflow once a hosted Postgres exists.
- i18n layer (the 404 and future user-facing strings); Playwright E2E.
- SQL-native free-room / conflict queries if the fetch-and-compute path gets hot.

## Checklist

- [x] Branch is `feat/bootstrap` off `main`
- [x] Conventional Commits, scoped per package
- [x] `pnpm typecheck lint format:check build test` green
- [x] Tests added (unit + integration); isolation proven against real Postgres
- [x] README / docs / `.env.example` updated
- [x] No secrets, no PII in logs/URLs, no AI attribution
