# feat(web): section timetable view switcher (four views) + de-noise Unverified

Targets `main`. UI only: no schema, no migration, no query change. Adds a client
view switcher to the section timetable so the four views can be compared live,
and replaces the per-class "Unverified" badge with a single header note.

## What

The section page fetches `views` on the server (unchanged) and hands them to a
thin `'use client'` `TimetableViews` switcher. Switching is an **instant in-place
toggle** (local state, no navigation) so the views compare side by side. Default
view is the compact list; day-scoped views default to today when it has classes.

Four views (all iOS-light, mobile-first, real rooms as green links, `HH:MM`):

- **Weekly grid** (`WeeklyGrid`): a calendar with weekday columns and a left time
  gutter; class blocks placed and sized by time, overlaps split into side-by-side
  lanes. Faint hour lines are a time ruler (a background gradient), not section
  dividers. On narrow screens the grid scrolls horizontally inside its own
  container, so the page never scrolls sideways.
- **Day tabs** (`DayTabs`): a weekday pill selector + that day's classes as a
  big-tap-target list. The phone-first view.
- **Compact list** (`CompactList`): the tightened, de-noised day-grouped list
  (the default). This is the old grid, minus the per-row badge.
- **Timeline** (`Timeline`): one day on a proportional vertical axis, so gaps read
  as empty space and overlaps split into lanes. Reuses the day selector.

Overlap lane assignment and the proportional scale live in a pure, unit-tested
helper (`views/time-scale.ts`); the shared class cell (`parts.tsx`: `ClassRow`,
`ClassBlock`, `Refs`) is used by all four.

**De-noise the "Unverified" badge:** removed the per-row `PendingBadge` and the
`<h1>` section badge on the section page; when any class is pending, a single
subtle line shows under the freshness line instead
(`Some classes are imported automatically and are pending review.`).

Scope is the section page (per the request). The teacher/room pages still use the
existing grid (with their per-row badge) and get the switcher in a follow-up; the
view components are already reusable.

## Assumptions & decisions

- Instant client toggle (chosen over URL-driven soft nav), so there is no
  shareable `?view=` link; the trade-off is zero-latency comparison. `@/lib/i18n`
  is pure, so the client switcher builds its own `t` from the `locale` prop; the
  messages catalog is the only meaningful client-bundle addition.
- Today-default for day-scoped views is applied in a mount effect, so the initial
  (deterministic first-day) render matches on server and client (no hydration
  mismatch).

## Data & migration impact

None.

## Tests

- Unit `test/time-scale.test.ts`: `minutes`/`hhmm`, `bounds`, and `assignLanes`
  (non-overlapping single lane; a pair into two lanes; independent overlap
  clusters).
- e2e `e2e/section-views.spec.ts`: from a cascade-selected section, the switcher
  shows four buttons (List default), each activates on click (instant toggle),
  the day-scoped views reveal a day tablist and Grid does not, and the section
  page shows no per-class "Unverified" text.
- Verified visually on real LGU data (all four views render correctly and
  distinctly; the timeline shows a real midday gap).

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm --filter web test:e2e` (11 pass).

## Verification steps

Open a section page, e.g. `/u/lgu/sections/<id>`; toggle Grid / Days / List /
Timeline and confirm each renders; confirm the single header note replaces the
per-row badges.

## Follow-ups

- Once you pick a favourite from live comparison, set it as the default and drop
  the unused views.
- Extend the switcher to the teacher and room pages (reuse these components).
