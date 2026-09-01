# Deploying Campus OS (lgu.campusos.reivex.io)

This is the step-by-step runbook to take the app from this repo to a live
deployment at **lgu.campusos.reivex.io**, using **Vercel** (Next.js hosting) and **Neon**
(serverless Postgres). Both have free tiers sufficient for production
(CLAUDE.md non-negotiable 1). Nothing here requires a paid tier.

> All commands run from the repo root. Never commit real secrets: everything
> sensitive is an env var (documented in `.env.example`) or a hosting secret.

## 0. Architecture recap

- **App**: Next.js App Router in `apps/web`, deployed on Vercel. Reads the DB
  **lazily** (`getDb()` / `getSqlClient()`), so `next build` needs no database.
- **DB**: single Postgres (Neon). Multi-tenant with **FORCE row-level security**;
  the app connects as a least-privilege, `NOBYPASSRLS` role.
- **Tenant routing**: resolved from the request host by middleware. Tenants nest
  under the platform root: with `TENANT_BASE_DOMAIN=campusos.reivex.io`,
  `lgu.campusos.reivex.io` resolves to the `lgu` tenant (subdomain label ->
  tenant slug). The bare `campusos.reivex.io` (`PLATFORM_HOST`) is the platform
  landing, not a tenant. `APP_DOMAIN=reivex.io` is legacy: the old flat
  `lgu.reivex.io` 308-redirects to the nested host (removable). SEO/canonical/
  robots/sitemap all derive from the live request host, so they are correct on
  the real domain.
- **Ingestion**: the `Ingest LGU timetable` GitHub Action runs the full
  autonomous crawl on a schedule against the hosted DB (gated; off until enabled).

## 1. Create the Neon project and database URL

1. Create a free project at <https://neon.tech>. Choose a region near users
   (e.g. a Europe or Asia region for LGU).
2. Note two connection strings from the Neon dashboard (both include
   `?sslmode=require`):
   - **Direct** (unpooled): used for migrations, seeding, and ingestion (they do
     DDL and benefit from a stable session).
   - **Pooled** (has `-pooler` in the host): used for the serverless app runtime.
3. Create the least-privilege app role and the production database. In the Neon
   SQL editor (connected as your project owner role), run, replacing the
   password with a strong secret you generate (do NOT reuse the dev password):

   ```sql
   CREATE ROLE campusos_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOBYPASSRLS PASSWORD '<STRONG_SECRET>';
   CREATE DATABASE campusos OWNER campusos_app;
   ```

   `NOBYPASSRLS` is essential: it guarantees RLS applies to the app role. Build
   the app's connection strings by putting `campusos_app` and `<STRONG_SECRET>`
   into the Neon direct and pooled hosts, database `campusos`.

   > Neon roles never bypass RLS and there is no superuser for users, so even the
   > owner role is safe behind our `FORCE ROW LEVEL SECURITY`. A dedicated
   > `campusos_app` role is still the least-privilege choice.

## 2. Migrate, seed, and do the first full ingest (against Neon)

Run these locally with `DATABASE_URL` set to the Neon **direct** string:

```bash
export DATABASE_URL='postgres://campusos_app:<STRONG_SECRET>@<neon-direct-host>/campusos?sslmode=require'

pnpm db:migrate:all     # base + module migrations (creates schema + RLS policies)
pnpm db:seed            # upserts the universities row for each tenant (lgu)
SOURCE_MODE=live pnpm ingest:lgu   # full autonomous crawl -> hosted DB
```

Then map the pending rooms so classes stop showing TBA: set `ADMIN_SECRET`,
start the app (or use the deployed one once step 3 is done), sign in at
`/u/lgu/admin/login`, and resolve each room at `/u/lgu/admin/rooms`.

> If the ingest reports many anomalies or fails to mint a session, the portal
> (`timetable.lgu.edu.pk`) is in one of its flaky windows (see
> `docs/overnight/DECISIONS.md`). Re-run during a stable window.

## 3. Create the Vercel project

1. Import the GitHub repo at <https://vercel.com/new>. Keep **Root Directory** at
   the repo root; `vercel.json` sets the framework (Next.js), the Turborepo build
   (`pnpm turbo run build --filter=web`), and the output (`apps/web/.next`).
   (Alternatively, set Root Directory to `apps/web` and let Vercel auto-detect;
   either works.)
2. Add **Environment Variables** (Production):

   | Variable             | Value                                            |
   | -------------------- | ------------------------------------------------ |
   | `DATABASE_URL`       | Neon **pooled** string (see note below)          |
   | `TENANT_BASE_DOMAIN` | `campusos.reivex.io`                             |
   | `PLATFORM_HOST`      | `campusos.reivex.io`                             |
   | `APP_DOMAIN`         | `reivex.io` (legacy; powers the removable 308)   |
   | `ADMIN_SECRET`       | a strong secret (enables the room-mapping admin) |

   > **Pooled vs direct at runtime.** The pooled endpoint (pgbouncer, transaction
   > mode) does not support prepared statements, which the current postgres.js
   > client uses by default. Until the client is configured with `prepare: false`
   > (a small follow-up), set the runtime `DATABASE_URL` to the Neon **direct**
   > string. It works as-is and is fine for this app's traffic. Switch to pooled
   > once `prepare: false` lands.

3. Deploy. `next build` runs with no DB access (lazy client), so the build
   succeeds even before the DB is reachable.

## 4. Point the hosts at Vercel

1. In the Vercel project: **Settings -> Domains -> Add** both `campusos.reivex.io`
   (the platform landing) and `lgu.campusos.reivex.io` (the tenant). Optionally
   also add the legacy `lgu.reivex.io` so old links 308 forward.
2. At your DNS provider for `campusos.reivex.io`, add the records Vercel shows,
   typically a `CNAME` per host (or a wildcard `*.campusos.reivex.io`) to
   `cname.vercel-dns.com`. Vercel issues TLS automatically (a wildcard domain
   needs DNS verification).

   | Type    | Name                | Value                  |
   | ------- | ------------------- | ---------------------- |
   | `CNAME` | `lgu` (in campusos) | `cname.vercel-dns.com` |

3. Because `TENANT_BASE_DOMAIN=campusos.reivex.io`, the middleware maps the `lgu`
   subdomain label to the `lgu` tenant with no per-host config. To add another
   university later, add its tenant config and a DNS record for its subdomain.

## 5. Enable scheduled ingestion

The `Ingest LGU timetable` workflow (`.github/workflows/ingest-lgu.yml`) runs the
full autonomous crawl twice daily, but is **gated off** until you enable it:

1. Repo **Secret** `DATABASE_URL` = the Neon **direct** string (the action
   migrates + ingests).
2. Repo **Variable** `HOSTED_DB_ENABLED` = `true`.
3. (Optional) Secret `LGU_PHPSESSID` only if you ever need to override the
   autonomous session; normally leave it unset.

Scheduled runs execute only when `HOSTED_DB_ENABLED` is `true`; a manual
**Run workflow** always executes. On failure it opens a labelled issue.

## Environment variables

See `.env.example` for the full list. Production needs: `DATABASE_URL`,
`TENANT_BASE_DOMAIN=campusos.reivex.io`, `PLATFORM_HOST=campusos.reivex.io`,
`ADMIN_SECRET`. `APP_DOMAIN=reivex.io` is optional (only the legacy 308).
`LGU_PHPSESSID` and the `LGU_MAX_*` caps are optional.

## Production readiness checklist

- [ ] Neon project created; `campusos_app` role is `NOBYPASSRLS`; `campusos` DB
      created.
- [ ] `pnpm db:migrate:all` applied against Neon (schema + RLS policies present).
- [ ] `pnpm db:seed` run (the `lgu` `universities` row exists).
- [ ] Full ingest completed; `ingestion_runs` has a `success` row.
- [ ] Rooms mapped via `/u/lgu/admin/rooms`; room=TBA is at or near 0.
- [ ] Vercel project deployed; `next build` green with no DB at build time.
- [ ] Env vars set on Vercel: `DATABASE_URL`, `APP_DOMAIN=reivex.io`,
      `ADMIN_SECRET`.
- [ ] `lgu.reivex.io` resolves, TLS valid, and the timetable renders.
- [ ] `https://lgu.reivex.io/robots.txt` and `/sitemap.xml` show the real domain.
- [ ] "Last updated" freshness line shows the latest ingest.
- [ ] Admin gate verified: `/u/lgu/admin/rooms` redirects to login when signed
      out; the resolve endpoint returns 401 without the admin cookie.
- [ ] Scheduled ingest enabled: `DATABASE_URL` secret + `HOSTED_DB_ENABLED=true`.
- [ ] RLS confirmed active (the app role cannot read across tenants).

## Notes and caveats

- **Portal stability**: `timetable.lgu.edu.pk` intermittently 404s from a Vercel
  edge in bursts. The crawler retries through blips and aborts on a real block.
  If the scheduled ingest keeps failing, it is an upstream LGU/DNS issue.
- **No secrets in git**: rotate anything that ever lands in a commit.
- **Backups**: Neon provides point-in-time restore on its free tier; no extra
  setup required.
