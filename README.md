# Campus OS

A multi-tenant, open-source campus platform. A "tenant" is a university; the
platform is built so a third party can add a new university, or a new feature
module, **without editing core code**.

- **Multi-tenant** — single database, shared schema, `tenant_id` on every
  scoped table, Postgres Row-Level Security as the enforcement boundary.
- **Modular** — each feature is a self-contained package that registers itself
  through a manifest. The first module is **Timetable**.
- **Free to run** — every dependency and service has a free tier or a
  self-hosted equivalent. No paid tier is required for production.

Canonical repository: <https://github.com/REIVEX-TECH/Campus-OS>

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

Dependency direction is strict: `apps → modules → core → db`. Modules never
import each other; they communicate through core interfaces and events.

## Prerequisites

- **Node.js ≥ 22.13** (required by pnpm 11; `.nvmrc` pins 24, matching the
  reference environment and CI).
- **pnpm 11** — `corepack enable` then `corepack use pnpm@11` (the
  `packageManager` field pins the exact version).
- **PostgreSQL 16+** — either a native install or the bundled Docker Compose
  service (see below).

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
```

### Database — pick one path

Campus OS talks to Postgres **only** through `DATABASE_URL`. **Supported: Postgres
16+** (the reference environment and the Docker image are Postgres 18). Both
paths below create a least-privilege role `campusos_app` and two databases,
`campusos_dev` and `campusos_test`. Row-Level Security is **forced**, so the app
role cannot read across tenants even if application-level filters are bypassed.

**Path A — native Postgres (primary).** Run the bootstrap once as a superuser,
then migrate:

```bash
# Windows (PowerShell), adjust the psql path to your install:
& "C:\Program Files\PostgreSQL\18\bin\psql" -U postgres -h localhost -f scripts/db-bootstrap.sql

# macOS/Linux:
psql -U postgres -h localhost -f scripts/db-bootstrap.sql
```

**Path B — Docker (for contributors without a local Postgres).**

```bash
docker compose up -d            # Postgres 18 + named volume + role/db bootstrap
```

Then, for either path:

```bash
pnpm db:migrate:all             # base db migrations, then module migrations
pnpm db:seed                    # seed the first tenant (lgu)
```

### Run the app

```bash
pnpm --filter web dev
```

- <http://localhost:3000/u/lgu> — LGU via the path-prefix fallback
- <http://lgu.localhost:3000> — LGU via subdomain (works out of the box in
  Chrome/Edge; `*.localhost` resolves to 127.0.0.1)
- <http://localhost:3000/u/unknown> — a proper 404
- `/robots.txt` and `/sitemap.xml` are generated per tenant from config

### Ingest a timetable (fixture mode — no network)

```bash
SOURCE_MODE=fixture pnpm ingest:lgu
```

## Quality gates

```bash
pnpm typecheck      # tsc across the workspace
pnpm lint           # eslint (flat config)
pnpm format:check   # prettier
pnpm build          # turbo build
pnpm test           # vitest unit tests
pnpm test:integration   # repositories + RLS against a real Postgres
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: branch off `main`
(`feat/…`, `fix/…`, `chore/…`, `docs/…`), use Conventional Commits, keep the
gates green, and update docs and `.env.example` in the same change. All
contributions are under the [MIT License](LICENSE).

Third-party attributions: [NOTICES.md](NOTICES.md).
