# chore: production deploy preparation (config only, not deploying)

Targets `main`. No schema change, no migration, no code behaviour change.

## What

Makes the app production-deployable to **Vercel + Neon** at **lgu.reivex.io** so
the only remaining work is human (create accounts, set secrets, add DNS, click
deploy). Nothing here deploys or contains a secret.

- **`vercel.json`**: Next.js framework, Turborepo build (`pnpm turbo run build
--filter=web`), output `apps/web/.next`, frozen-lockfile install. The build
  reads the DB lazily, so it needs no database (proven by the CI verify job,
  which builds with no `DATABASE_URL`).
- **`docs/DEPLOY.md`**: a full runbook with exact steps for (1) Neon project +
  least-privilege `NOBYPASSRLS` role + connection URLs, (2) migrate + seed + full
  ingest against Neon, (3) Vercel project + env vars, (4) `lgu.reivex.io` DNS,
  (5) enabling scheduled ingestion. Plus a production readiness checklist and the
  pooled-vs-direct and portal-flakiness caveats.
- **Scheduled ingest** (`.github/workflows/ingest-lgu.yml`): enabled a twice-daily
  cron, **gated** by the repo variable `HOSTED_DB_ENABLED` (scheduled runs only
  when it is `true`; manual dispatch always runs), so it never runs before a
  hosted DB exists. Uses the autonomous session (no cookie), applies migrations
  idempotently, then runs the full crawl. Opens an issue on failure.
- **`.env.example`**: documents `APP_DOMAIN=reivex.io` for production.

## Multi-tenant host routing (verified)

`subdomainOf('lgu.reivex.io', 'reivex.io')` returns `'lgu'`, which resolves the
`lgu` tenant. SEO, canonical, robots, and sitemap all derive from the live
request host (`headers().get('host')`), so they are correct on the real domain
with no per-host config. Production needs only `APP_DOMAIN=reivex.io`.

## Data & migration impact

None. Config, docs, and a workflow only.

## Tests

No new tests (config/docs). Existing gates unchanged:

```bash
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Verification

- `pnpm turbo run build --filter=web` (the Vercel build command) succeeds.
- The CI `verify` job builds `apps/web` with no `DATABASE_URL`, confirming the
  build needs no database.
- `docs/DEPLOY.md` checklist is the human's go-live list.

## Honest state

Deploy-**ready pending human steps**: create the Neon and Vercel accounts, set
`DATABASE_URL` / `APP_DOMAIN` / `ADMIN_SECRET`, add the `lgu.reivex.io` DNS
record, run migrate + seed + ingest, map rooms, and flip on the scheduled ingest.
All of these are in `docs/DEPLOY.md`. The one external unknown is the LGU portal's
intermittent flakiness (Phase 2), which affects data freshness, not deployability.
