# feat(ingest): freshness health check + harden the cron so a stall is loud

The LGU ingest stopped persisting on Sep 6 and ran silently broken for 22 days; a manual
`pnpm ingest:lgu` works. This makes a stall loud (a monitorable health check) and removes
the most likely reason a cron run diverges from a manual one.

## Why the cron could stop persisting while a manual run works

`scripts/cron-ingest.sh` shell-sourced `.env` (`set -a; . ./.env; set +a`) before
`pnpm ingest:lgu`. Shell sourcing mis-parses any value with a shell-special character —
a `#` truncates the value (treated as a comment), `$`/spaces/quotes mangle it — whereas a
manual run and the ingest script itself parse `.env` with `dotenv`, which handles them.
So a DB URL/password containing such a character (e.g. after a rotation around Sep 6) would
give the **cron** a broken `DATABASE_URL` and fail, while a **manual** run stayed fine.
With `set -euo pipefail` the script then exited, and its only output went to
`/var/log/campusos-ingest.log`, which nothing watched — a silent failure.

**Fix:** the cron no longer sources `.env`; the ingest loads it via `dotenv/config` exactly
as a manual run does, so the two parse the env identically. This is a strong candidate, not
a confirmed root cause (I can't read the VPS from here) — `docs/DEPLOY-VPS.md` §7b adds the
exact diagnostics (`ingestion_runs`, the log, the crontab) to confirm on the box; other
plausible causes (a cron `PATH`/`HOME` that can't find `node`/`pnpm`, a removed crontab
line) are covered there too. Either way, the health check below makes the next stall loud.

## What

- `apps/web/app/api/health/ingest/route.ts` (new) — `GET`, unauthenticated, side-effect
  free. `200` when every monitored tenant's last **successful** ingest is within
  `INGEST_STALE_HOURS` (default 14 = the 12h cron cadence + buffer), `503` when any is
  stale, with a JSON body naming each tenant and its age. For Uptime Kuma / any HTTP
  monitor.
- `apps/web/lib/ingest-health.ts` (new, pure, unit-tested) — the staleness evaluation.
- `scripts/ingest-lgu.ts` — optional push heartbeat: if `INGEST_HEALTHCHECK_URL` is set, a
  successful run pings it and a failure pings `<url>/fail` (healthchecks.io). Best effort;
  never fails the ingest.
- `scripts/cron-ingest.sh` — drop the fragile `.env` shell-sourcing (see above).
- `docs/DEPLOY-VPS.md` — the monitor setup (pull + push) and a "diagnosing a silent ingest
  failure" runbook; the manual backfill example drops the same shell-sourcing.

## Why the signal is `ingestion_runs`, not `timetable_entries.created_at`

The task suggested `max(created_at)` on `timetable_entries`, but the ingest is idempotent
and only writes a new versioned entry when the timetable actually changes (today's manual
run: `inserted=2 unchanged=2209`). A stable schedule — nights, weekends, mid-semester —
legitimately has no new entry for days, so `created_at` age would false-alarm constantly
and get muted, which is how a silent failure happens again. The health check keys on the
last **successful `ingestion_runs`** row instead (the app's `freshness()` already uses it),
which advances on every successful run regardless of whether data changed. `timetable_entries`
freshness is a red herring here; `ingestion_runs` is the true "did it run" signal.

## Data & migration impact

No schema change. Reads `ingestion_runs` (existing).

## Tests / verification

`turbo run typecheck lint` and the web vitest suite (171, incl. 5 new `ingest-health` cases:
fresh, the 22-day stale case, never-ingested-not-flagged, one-stale-fails-all, boundary)
pass. **Verified live against the local dev DB:** `GET /api/health/ingest` returned `503`
with `lgu` `stale:true` (last success ~27 days old) and `demo`/`testu` `stale:false`
(never ingested) — exactly the alert that would have caught the 22-day failure. The ingest
script's new control flow was exercised via the unknown-tenant path (exits 1, no crawl).

## Follow-ups

- Confirm the VPS root cause with §7b's diagnostics next time the box is reachable; if it
  was the `.env` sourcing, this PR fixes it, otherwise the health check still surfaces it.
- Wire the monitor (Uptime Kuma on the pull endpoint, and/or `INGEST_HEALTHCHECK_URL` for
  healthchecks.io) — an ops step, noted in the runbook.
