# Overnight autonomous run — progress log

Chronological notes, one block per phase. Newest appended at the bottom.

## Run start

- Branch base: `main` @ 5c8dea7 (PR #3 merged).
- Plan: Phase 1 (design system + room admin) → Phase 2 (full LGU crawl) →
  Phase 3 (deploy prep). Each phase = its own PR, merged only when CI green.

## Phase 1 — Design system + room-mapping admin

- Branch `feat/design-system-and-room-admin` off `main` @ 5c8dea7.
- Part 1: design tokens + docs/design.md (neumorphism on interactive surfaces
  only, static flat + high contrast, WCAG AA computed, tenant accent live, dark
  mode active), no-dash + no-divider enforced (Vitest scanner + ESLint JSXText).
- Part 2: `0002_room_source` migration, sink self-heal via resolved aliases,
  `AdminRoomsRepository`, admin UI at `/u/[slug]/admin/rooms`, provisional
  server-side authz gate (env `ADMIN_SECRET` -> per-tenant HMAC cookie; fails
  closed; enforced on every page AND every mutation).
- Local gates: `pnpm turbo run typecheck lint format:check build test` = 22/22
  green; module + db integration green (incl. map-then-reingest hash stability,
  alias self-heal, RLS isolation); authz unit + e2e (route + mutation blocked).
- Verification (fixture ingest into campusos_dev, then map all pending rooms):
  BEFORE room=TBA 41/41 (15 pending rooms) -> AFTER room=TBA 0/41.
- PR #4 merged. Merge SHA: 00b5489e73629555046960d0b420daa39e6b4258. CI green
  on the first run (no flaky deadlock).

## Phase 2 — Full LGU crawl

- Branch `feat/full-crawl` off `main` @ 00b5489.
- Shipped the full-crawl CODE: `crawl()` walks every semester x degree x
  section; robust (bad section -> anomaly + skip; block -> abort; fixture
  missing -> silent skip); backoff on transient failures; optional politeness
  caps; resilient autonomous session; recorder drives crawl via a recording
  client. normalize spans many semesters/degrees and maps anomalies to unmapped.
- Tests: crawl.test.ts (cartesian + anomaly + caps), normalize (multi + anomaly),
  source (clean fixture slice). 12 adapter tests; full gates 22/22 green.
- ⚠️ LIVE full crawl + fresh full data BLOCKED by host instability
  (timetable.lgu.edu.pk round-robins to a Vercel 404 edge in bursts; not a
  block, but not crawlable). Paused the live portion per the rules; recorded in
  docs/overnight/DECISIONS.md. Fixture-mode ingest unchanged (41 entries clean).
- PR #5 merged. Merge SHA: aa45f9180a634e1d1db74d61e855ec0b0ab830d3. CI green
  first run.

## Phase 3 — Deploy preparation (config only)

- Branch `chore/deploy-prep` off `main` @ aa45f918.
- vercel.json (Turborepo build for web, Next framework, lazy-DB build).
- docs/DEPLOY.md: full runbook (Neon project + role + URL; migrate + seed +
  full ingest; Vercel project + env vars; lgu.reivex.io DNS; enable scheduled
  ingest) + production readiness checklist.
- Enabled the scheduled ingest workflow, gated by repo var HOSTED_DB_ENABLED
  (scheduled runs only when set; manual dispatch always). Autonomous session,
  full crawl, migrate step, twice-daily cron.
- Confirmed multi-tenant host routing: subdomainOf('lgu.reivex.io','reivex.io')
  -> 'lgu'; SEO/robots/sitemap/canonical derive from the live host. Prod needs
  only APP_DOMAIN=reivex.io.
- next build succeeds with no DB at build time (lazy client; CI verify job
  proves it).
- PR #6 merged. Merge SHA: 327b05bc24e71a02177dfd6e18fdd1492e90ae68. CI green
  first run.

## Run complete

All three phases merged to main (@ 327b05b). Final report in
docs/overnight/REPORT.md. Only paused item: the live full crawl / fresh full
real data (Phase 2), blocked by portal host flakiness (DECISIONS.md).
