# feat(web): read-only admin analytics

Targets `main`. Read-only over existing data; no schema or migration change, no
new data collection.

## What

A read-only analytics panel at `/u/[slug]/admin/analytics`, behind the existing
admin gate (`requireAdmin`, the same single-secret cookie the room admin uses).
It counts data that already exists; it collects nothing new.

- **Query.** `TimetableQueries.analytics()` returns aggregate counts, tenant
  scoped (RLS), all read-only: totals (terms, programs, sections, courses,
  teachers, rooms, current classes); current classes grouped by kind and by ISO
  weekday (every kind and all seven days always present); coverage (how many
  current classes have a teacher / a room); and pending-review counts. "Current"
  means the live entry version (`valid_to is null`); totals exclude soft-deleted
  rows.
- **Page.** At-a-glance stat cards, two coverage bars, "classes by kind" and
  "classes by day" bar charts, and pending-review counts. Charts are plain
  server-rendered CSS bars (no chart library, nothing added to the client
  bundle). Full-width, compact, light + dark, WCAG AA (counts are real text; bars
  are decorative `aria-hidden`).
- **Nav.** The rooms admin links to Analytics and back, so the admin area has a
  simple two-page nav.

## Data & migration impact

None. No schema change, no new tables, no data collection. Only reads.

## Tests

- Integration (`queries.integration.test.ts`): `analytics()` returns the right
  totals, per-kind and per-day counts (all buckets present), coverage (a TBA
  teacher/room lowers it), and pending counts.
- e2e (`admin-auth.spec.ts`): the analytics route is gated server-side (an
  unauthenticated visitor is redirected to login), alongside the existing rooms
  gate assertion.
- `pnpm turbo run typecheck lint build`, `pnpm --filter @campusos/module-timetable
test:integration` (26), and `pnpm --filter web test:e2e` (16) pass; format
  applied.
- Verified visually against the local dev data (both themes) behind the admin
  login.

## Verification steps

Sign in at `/u/lgu/admin/login`, then open `/u/lgu/admin/analytics`: totals,
coverage bars, classes by kind and by day, pending counts. Toggle theme; both
hold in light + dark. Visiting the page unauthenticated redirects to login.

## Follow-ups

- None. When the identity module replaces the single-secret admin gate, this page
  moves behind it unchanged (it only calls `requireAdmin`).
