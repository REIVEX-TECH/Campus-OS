# fix(timetable): selecting term/program/section is a soft navigation

Selecting a term, program or section on the timetable reloaded the whole page and lost the
schedule view mode, the "Recently viewed" sidebar, and scroll position. This moves the
server-component boundary so the selectors and sidebar live in a stable layout and only the
schedule pane re-renders from the URL segment (the messages two-pane pattern). The path
form and the canonical redirect for direct loads are unchanged; this only affects in-app
selection.

## What

- `apps/web/app/u/[slug]/timetable/layout.tsx` (new) — renders the chrome once: header,
  free-rooms rail, the cascade selectors, and the sidebar. Preloads the whole cascade
  (terms + programs + sections, tiny rows) once per page load so the client picker can
  switch without a round trip. Because it is a layout, it is preserved across child
  navigations, so the selectors and sidebar never unmount or flicker.
- `apps/web/app/_components/timetable-selectors.tsx` (new, client) — the picker + sidebar.
  Reads the active selection from the pathname and filters the preloaded cascade
  client-side; `router.push`es the path form on each choice (`scroll: false`).
- `apps/web/app/u/[slug]/timetable/[[...filters]]/page.tsx` — slimmed to just the schedule
  pane (the selected section's timetable, or the pick prompt) plus `RecordRecent`.
  `generateMetadata` (name-based title + `/sections/{id}` canonical) is unchanged, so
  direct loads keep their SEO.
- `apps/web/app/_components/timetable-views.tsx` — the chosen view (Grid/Days/List/Timeline)
  is now a remembered reader preference: restored on mount from `localStorage`, and
  persisted only on the reader's own changes (never the mount default), so switching
  sections keeps the current view instead of snapping back.
- Removed `timetable-workspace.tsx` (its two-pane grid moved to the layout) and
  `timetable/loading.tsx` (a child loading boundary would flash a skeleton on every
  selection and risk turning a `notFound()` into a committed 200; without it App Router
  keeps the previous schedule visible until the new one arrives).

## Data & migration impact

No schema change. Routing/rendering only.

## Tests / verification

`turbo run typecheck lint` and the web vitest suite (166) pass. A new e2e asserts that
selecting a section changes the URL to the path form while a `window` marker set beforehand
survives (proving a soft navigation, not a full reload) and the selectors stay mounted.

**Verified in a real browser against LGU dev data:** selecting semester -> program ->
section each updates the URL to the path form with the window marker intact (soft nav); the
schedule pane updates while the picker and sidebar stay mounted; the view mode (set to
Timeline) is preserved across section changes and restored on a fresh direct load; the
page-title metadata still resolves to the term/program/section names; no console errors.

## Follow-ups

- The layout preloads all sections for the tenant (small for LGU). If a tenant ever has
  a very large section count, the section list can move to an on-demand fetch; noted, not
  needed now.
