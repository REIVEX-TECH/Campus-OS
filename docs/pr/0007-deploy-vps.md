# docs: self-hosted VPS deploy runbook (lgu.reivex.io)

Targets `main`. Docs and deploy helpers only; no app code or behaviour change.

## What

The deploy target moved from Vercel/Neon to a self-hosted VPS (Ubuntu 24.04,
shared Postgres 16 on localhost, nginx TLS, pm2, port 3003, Node 22 via nvm). This
adds a precise, copy-paste runbook tailored to that box, plus the small repo-local
helpers it references. Nothing here runs against the server; the operator executes
each step.

- **`docs/DEPLOY-VPS.md`**: the runbook, in order — prereqs (nvm Node 22 without
  disturbing the system Node, corepack pnpm, clone); database on the SHARED
  cluster (scoped role + db, migrate, seed); production `.env`; build + run under
  pm2 on 3003 with a per-app Node interpreter; nginx vhost + certbot; room mapping;
  autonomous refresh via **cron** (replacing the GitHub workflow for an
  always-on box); the later full-data backfill; and a production smoke checklist.
  Every step is marked **SHARED INFRA** (Postgres/nginx the operator runs
  carefully) vs **CAMPUSOS-LOCAL** (safe).
- **`scripts/db-bootstrap-prod.sql`**: idempotent bootstrap for a shared cluster —
  creates ONLY `campusos_app` (`NOBYPASSRLS`) and the `campusos` DB, and gives the
  role ownership of that DB's `public` schema. Password passed via a psql
  variable, never written to the file.
- **`ecosystem.config.cjs`**: pm2 definition running `next start -p 3003` under a
  per-app Node (`CAMPUSOS_NODE` from `nvm which 22`), so the system Node other
  apps use is untouched. Secrets come from the sourced repo-root `.env`; no secret
  in the file.
- **`scripts/cron-ingest.sh`**: portable cron entry (Node 22 + `.env`) running the
  full live crawl with the adapter's flaky-portal retry.
- **`.nvmrc`** (`22`) and **`.env.example`** (`PORT`, runbook pointers).

## Tenant routing (restated + verified)

`subdomainOf('lgu.reivex.io', 'reivex.io')` returns `'lgu'`, resolving the `lgu`
tenant, so with `APP_DOMAIN=reivex.io` and nginx forwarding the real `Host`
header, `lgu.reivex.io` serves the `lgu` tenant with no per-host config. The
runbook flags `proxy_set_header Host $host;` as critical for exactly this reason.

## Data & migration impact

None. Docs, one SQL helper, a pm2 config, a shell script, an `.nvmrc`.

## Tests

No new tests (docs/ops). Existing gates unchanged:

```bash
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Notes

- Standalone Next output is intentionally not enabled; `next start` runs directly
  from the cloned repo. The runbook explains why and when standalone would help.
- The `HOSTED_DB_ENABLED` GitHub ingest workflow stays in the repo but is unused
  on the VPS (the cron replaces it); the runbook says to leave its repo variable
  unset.
- The nginx vhost is a certbot-managed baseline; if your existing vhosts use
  shared SSL snippets, share one and the runbook's nginx section can be aligned.
