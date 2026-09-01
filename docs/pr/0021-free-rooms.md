# feat(web): free / available rooms (public, read-only)

Targets `main`. Read-only over existing data; no schema or migration change.

## What

A public `/u/[slug]/free-rooms` page: pick a day and time window and see which
rooms are free, each linking to its own schedule (`/rooms/[id]`, which already
exists).

- **Query.** New `TimetableQueries.freeRooms({ termId, dayOfWeek, startsAt, endsAt })`
  returns live rooms (id, name, building) with no current entry overlapping the
  window in the active term, reusing the pure `freeRooms` domain helper. Tenant
  scoped (RLS). Covered by an integration test (busy room excluded, free room
  returned with its building).
- **Free now by default.** With no query params the page uses the tenant's current
  local weekday and time (a `tenantNow(timezone)` helper, since weekly slots are
  wall-clock in the tenant timezone per CLAUDE.md), for the next hour. A thin
  client control (day select, from/to time inputs, "Free now" button) writes
  `?day&from&to` and soft-navigates; the server recomputes.
- **UI.** Full-width, compact, iOS, both themes: a control row, a count line, and
  a responsive grid of room cards. Added to the tenant nav.

## Data & migration impact

None (read-only).

## Tests

- Integration: `TimetableQueries.freeRooms` (exclude busy, include free + building).
- e2e: the page renders the control and lists room links for a pre-class window.
- `pnpm turbo run typecheck lint format:check test build` (22),
  `pnpm test:integration` (module 23), `pnpm --filter web test:e2e` (12) pass.
- Verified live on `campusos_dev` (after a room backfill): "free now" default,
  day/time control, room cards linking to per-room schedules.

## Verification steps

Open `/u/lgu/free-rooms`; it defaults to rooms free right now; change the day/time
or hit "Free now"; click a room to see its schedule.

## Follow-ups

- SEO enumerates the free-rooms URL in the sitemap (SEO PR).
