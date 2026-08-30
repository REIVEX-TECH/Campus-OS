# feat: timetable UI — section/teacher/room views, ICS feeds, per-page SEO

Depends on PR #1 (bootstrap) being merged to `main`. Targets `main`.

## What

The first real UI: accessible timetable views over the imported data, plus
calendar feeds, rendered **honestly** against partly-unverified data.

- **Read model** (`@campusos/module-timetable`) — enriched, tenant-scoped
  queries (section/teacher/room timetables with resolved names + pending/TBA
  flags, term & section listings, and last-successful-ingestion freshness), a
  pure `buildWeekGrid`, and an RFC 5545 ICS generator (VTIMEZONE/TZID, weekly
  RRULE, stable logical-slot UIDs with a collision suffix).
- **Web** (`apps/web`) — section picker (grouped by program), and section,
  teacher, and room views using one accessible weekly grid (semantic `<table>`
  with scoped headers + caption). Public by-URL ICS feeds per view. Per-page
  `generateMetadata` (tenant title template + entity name, description,
  canonical, OpenGraph). A minimal i18n scaffold routes every string, including
  aria labels, through the tenant locale.
- **Honest rendering** — "TBA" for null room/teacher, an "Unverified" badge for
  pending dimensions, a provenance footer, a term-dates-pending note, designed
  empty states, and a "Last updated …" line (or "Not yet imported").
- **Design system** (`@campusos/ui`) — Badge, Card, and Table.
- **Guardrails** — the app import guard now also bans data-source adapters; a
  Playwright smoke covers picker → grid and the ICS endpoint; CI gains an e2e
  job and runs the module read tests in the Postgres integration job.
- **Internal refactor** — the db client initialises lazily (`getDb()`/
  `getSqlClient()`) so `next build` needs no database.

## Why

Everything so far was schema, ingestion, and tenancy with no way to see a
timetable. This delivers the student-facing views and the calendar-subscription
path, and sets the pattern (read model in the module, thin RSC pages) for future
module UIs. Rendering imported data honestly (TBA/Unverified/pending) is
deliberate — it shows users what is and isn't confirmed.

## How to test

```bash
pnpm install
pnpm turbo run typecheck lint format:check build test    # all gates
pnpm --filter @campusos/db test:integration              # RLS isolation
pnpm --filter @campusos/module-timetable test:integration # enriched reads
SOURCE_MODE=fixture pnpm ingest:lgu                       # populate dev data
pnpm --filter web dev
```

- `/u/lgu/timetable` → section picker (BSCS-A/B, "Unverified", "Last updated …").
- A section → weekly grid with **Room: TBA**, **Unverified**, term-dates-pending
  note.
- `/u/lgu/sections/<id>/timetable.ics` → `200 text/calendar` with
  `VTIMEZONE Asia/Karachi`, a `UID`, and a weekly `RRULE`.
- `/u/lgu/sections/unknown` → 404.

E2e smoke: `pnpm --filter web build && pnpm --filter web exec playwright install chromium && pnpm --filter web test:e2e`.

## Migration notes

**No schema change.** Read-only UI over existing tables and indexes; RLS
unchanged; all reads go through tenant-context repositories. Rollback = revert
the branch.

## Screenshots

The browser pane could not composite screenshots in the build environment;
rendered output was verified via HTTP (picker + section text, ICS headers/body)
and is documented in `docs/timetable-ui.md`. Attach screenshots when running
`pnpm --filter web dev` locally.

## Breaking changes

None for consumers. Internal only: the db package now exposes `getDb()`/
`getSqlClient()` instead of eager `db`/`sqlClient` singletons.

## Known limitations

- URLs use raw UUIDs (e.g. `/sections/<uuid>`); human-readable slug paths are a
  follow-up once dimension data is verified.
- The grid shows `HH:mm:ss`; trimming to `HH:mm` is a small follow-up.
- ICS supports fixed-offset (non-DST) timezones only and **throws** on others
  (DST support via Luxon is a follow-up).
- The Playwright smoke runs in CI; locally it needs the chromium browser
  installed (`playwright install chromium`).

## Follow-ups

Human-readable slug URLs; DST-accurate VTIMEZONE; `change_subscriptions`
notifications (needs identity); admin UI to resolve pending dimensions; `HH:mm`
formatting; more locales (`ur-PK`/RTL); free-room finder UI.

## Checklist

- [x] Branch off `main`; Conventional Commits scoped per package
- [x] `pnpm typecheck lint format:check build test` green
- [x] Unit + integration tests added; e2e smoke + CI job
- [x] `README`/`docs`/`.env.example` updated as needed
- [x] No secrets, no PII in logs/URLs, no AI attribution
