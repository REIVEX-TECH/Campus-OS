# Campus OS

CampusOS is an open-source, multi-tenant campus platform. A "tenant" is a
university, and the platform is built so a third party can add a new university,
or a new feature module, **without editing core code**.

It runs live at **[campusos.reivex.io](https://campusos.reivex.io)**, which is
the platform home and lists the universities on it. The first tenant is Lahore
Garrison University at **[lgu.campusos.reivex.io](https://lgu.campusos.reivex.io)**,
and the first module is **Timetable**: live, searchable class schedules with
per-section, per-teacher, and per-room views and subscribable calendar feeds.

The project is young and built in the open. If a rule only ever applies to one
university, it belongs in that tenant's config or a tenant adapter, never in the
shared core.

## What it gives you

- **Multi-tenant by design.** One database, one shared schema, a `tenant_id` on
  every scoped row, and Postgres Row-Level Security as the enforcement boundary.
  The app connects as a least-privilege role that cannot read across tenants even
  if an application filter is missed.
- **Modular.** Each feature is a self-contained package that registers itself
  through a manifest (routes, navigation, permissions, migrations, jobs). A
  tenant enables the modules it wants; a disabled module contributes nothing.
- **Free to run.** Every dependency and hosted service has a free tier or a
  self-hosted equivalent. No paid tier is required for production.

Canonical repository: <https://github.com/REIVEX-TECH/Campus-OS>

## Architecture in brief

- **Web app.** Next.js (App Router) in `apps/web`, server-first, reading the
  database lazily so a build needs no database.
- **Multi-tenancy.** A single Postgres database with a shared schema. Every
  tenant-scoped table carries a `tenant_id` and has **FORCE ROW LEVEL SECURITY**;
  the runtime connects through one `DATABASE_URL` as a `NOBYPASSRLS` role, so the
  database, not the application, is the isolation boundary.
- **Tenants on wildcard subdomains.** `lgu.campusos.reivex.io` resolves to the
  `lgu` tenant, while the bare `campusos.reivex.io` serves the platform landing.
  Middleware resolves the tenant from the request host once and passes it down; a
  `/u/{slug}` path form is the local-dev fallback. Adding a university is a tenant
  config plus a DNS record, no per-host code.
- **Autonomous timetable ingestion.** A source adapter mints its own anonymous
  session against the upstream portal (no login, no stored credentials), crawls
  politely, and emits normalized records. The pipeline persists them and versions
  every change with `valid_from` and `valid_to`, so schedule changes are
  detectable and never overwrite history. Rooms and teachers are created from the
  crawled data as trusted records.
- **Design system.** A small Tailwind v4 (CSS-first) design language shared
  through `packages/ui`. The visual rules live in [docs/design.md](docs/design.md).

Dependency direction is strict: `apps → modules → core → db`. Modules never
import each other; they communicate through core interfaces and events.

## Repository layout

```
apps/web                 Next.js App Router front end
packages/core            domain types, interfaces, module registry, ingestion pipeline
packages/db              Drizzle schema, migrations, tenant repositories
packages/ui              design system (Tailwind v4 + shadcn/ui)
packages/config          shared eslint / prettier / tsconfig
packages/modules/*       one package per feature module (e.g. timetable)
packages/adapters/*      one package per data source (e.g. timetable-lgu)
tenants/                 per-tenant config, branding, SEO, module toggles
```

## Running it locally

### Prerequisites

- **Node.js 22.13 or newer** (required by pnpm 11; `.nvmrc` pins 24, matching CI).
- **pnpm 11.** Run `corepack enable`, then `corepack use pnpm@11` (the
  `packageManager` field pins the exact version).
- **PostgreSQL 16 or newer**, either a native install or the bundled Docker
  Compose service.

### Setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

CampusOS talks to Postgres only through `DATABASE_URL`. Both database paths below
create a least-privilege role `campusos_app` and two databases, `campusos_dev`
and `campusos_test`, with Row-Level Security forced on.

**Path A, native Postgres.** Run the bootstrap once as a superuser:

```bash
# Windows (PowerShell), adjust the psql path to your install:
& "C:\Program Files\PostgreSQL\18\bin\psql" -U postgres -h localhost -f scripts/db-bootstrap.sql

# macOS/Linux:
psql -U postgres -h localhost -f scripts/db-bootstrap.sql
```

**Path B, Docker** (for contributors without a local Postgres):

```bash
docker compose up -d            # Postgres + named volume + role/db bootstrap
```

Then, for either path, migrate and seed:

```bash
pnpm db:migrate:all             # base db migrations, then module migrations
pnpm db:seed                    # seed the first tenant (lgu)
```

### Run the app

```bash
pnpm --filter web dev
```

- <http://localhost:3000/u/lgu> serves LGU through the path-prefix fallback.
- <http://lgu.localhost:3000> serves LGU through the subdomain form (works out of
  the box in Chrome and Edge, since `*.localhost` resolves to 127.0.0.1).
- <http://localhost:3000/u/unknown> returns a proper 404.
- `/robots.txt` and `/sitemap.xml` are generated per tenant from config.

### Ingest a timetable (fixture mode, no network)

```bash
SOURCE_MODE=fixture pnpm ingest:lgu
```

### Quality gates

```bash
pnpm typecheck          # tsc across the workspace
pnpm lint               # eslint (flat config)
pnpm format:check       # prettier
pnpm build              # turbo build
pnpm test               # vitest unit tests
pnpm test:integration   # repositories + RLS against a real Postgres
```

## Deploying

Two supported paths, each with a full runbook:

- **Self-hosted VPS** (nginx, pm2, a shared Postgres, wildcard subdomains):
  [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md).
- **Vercel and Neon** (both free tiers): [docs/DEPLOY.md](docs/DEPLOY.md).

Both explain the three host variables (`TENANT_BASE_DOMAIN`, `PLATFORM_HOST`, and
the legacy `APP_DOMAIN`) that control how a request host maps to a tenant.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: branch off `main`
(`feat/…`, `fix/…`, `chore/…`, `docs/…`), use Conventional Commits, keep the
gates green, and update docs and `.env.example` in the same change. One house
rule worth knowing up front: user-facing copy uses no dash punctuation (write
"8:00 to 9:30", not a dash), and separation is spacing, never divider lines.

All contributions are under the [MIT License](LICENSE). Third-party attributions
are in [NOTICES.md](NOTICES.md).
