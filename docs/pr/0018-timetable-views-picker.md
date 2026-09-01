# fix(web): the picker inline timetable uses the shared view switcher

Targets `main`. UI only: no schema, migration, or query change. Follow-up to
PR #19, which added the four-view switcher to the section page but left the
cascade picker's inline render on the old single grid.

## Why

There were two render paths for the same section timetable. PR #19 redesigned the
section page (`/sections/[id]`) to the four-view switcher and the single
pending-review note, but the cascade picker on `/timetable` renders its OWN inline
timetable for the `?term&program&section` selection, and that path still used the
old `TimetableGrid` with per-row "Unverified" badges. So picking a section in the
cascade looked different from visiting the section page directly.

## What

- **One shared component** `SectionTimetableView` (`app/_components/`) now renders
  the entire section-timetable experience: the single pending-review note, the ICS
  subscribe control, and the four-view switcher (`TimetableViews`), or the empty
  state. The pending note keys off `views.some((v) => v.pending)`, which the read
  layer already defines as section-or-teacher pending, so it covers both.
- **Both paths import it.** `/timetable` (picker inline, passing the section title
  since it has no section `<h1>`) and `/sections/[id]` (no title; the page `<h1>`
  already names it) render `<SectionTimetableView />`. Neither page renders the
  timetable internals directly any more, so they cannot drift again.
- The old `TimetableGrid` is untouched and still used by the teacher and room
  pages (their switcher is the planned follow-up).

## Assumptions & decisions

- Subscribe moves from the section page header's top-right into the shared block
  (above the switcher), matching the picker; the section header keeps the
  breadcrumb, title, and freshness line.
- No behaviour change to the four views, the picker cascade, or ICS.

## Data & migration impact

None.

## Tests

- `e2e/timetable.spec.ts` (picker) now also asserts the inline render shows the
  four-view switcher (the `View` group has four buttons) and that no per-class
  "Unverified" text appears, locking the two paths together.
- Existing section-views, section-page, and cascade e2e still pass (11 total).
- Verified live: the `/timetable` inline result now shows the identical title,
  single pending note, Subscribe, and Grid/Days/List/Timeline switcher as the
  section page.

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm --filter web test:e2e`.

## Verification steps

Open `/u/lgu/timetable`, pick a semester/program/section, and confirm the inline
result is the four-view switcher with the single header note (no per-row badge),
identical to `/u/lgu/sections/<id>`.

## Follow-ups

- Extend the switcher (via these components) to the teacher and room pages.
- Once you pick a default view from live comparison, set it and drop the rest.
