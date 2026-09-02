# feat(web): optional timetable filters

Targets `main`. Adds optional, read-only filters to every timetable surface. No
schema change, no new data collection.

## What

- **Filters**: a time window (from / to) plus day, type, class, teacher, and room.
  Each dimension only offers the values actually present in the current class
  list, so a teacher page never offers a teacher chip it cannot vary.
- **Where**: the section view (`timetable-views`) and the single-grid teacher and
  room pages, via a shared `useTimetableFilters` hook, so the four views (grid,
  days, list, timeline) and the day-grouped grid all filter identically.
- **Unobtrusive**: collapsed by default behind a "Filters" toggle that shows an
  active-filter count. The panel is a bottom sheet on phones and a centred dialog
  on wider screens, focus-contained, Escape and backdrop close it, and focus
  returns to the trigger.
- **Horizontal layout**: the panel lays its groups out in a responsive grid (two
  columns from `sm`, three from `lg`) inside a wider sheet, so the filters read
  across rather than down and the panel needs far less scrolling.
- **Shareable**: filter state lives in the URL and is written with the History
  API, so toggling a filter does not re-fetch. Filters reset when the section
  changes.

## Data & migration impact

None. Read-only filtering of an already-fetched class list.

## Tests

- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (28) pass; format applied.
- Verified in the browser: the panel opens as a three-column dialog on desktop
  (no long scroll), filters narrow every view, and the empty result shows a
  "nothing matches" card.

## Verification steps

Open a section timetable, press "Filters": the panel shows the time window and
the chip groups side by side. Toggle chips or set a time window; every view
reflects it and the URL carries the state.

## Follow-ups

- Course chips show the raw course code from the import, which can be a long
  slug; a shorter display label is a data-side improvement.
