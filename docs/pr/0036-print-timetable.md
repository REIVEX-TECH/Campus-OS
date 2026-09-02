# feat(web): print stylesheet for timetables

Targets `main`. CSS/UI only; no schema or migration change.

## What

Printing a page (students often print their schedule) now produces a clean
schedule instead of the full app UI.

- A `@media print` block in the design tokens (`packages/ui/src/styles/globals.css`):
  forces a light layout regardless of the active theme (overrides the core tokens
  to light, so a dark-mode user still prints on white), flattens elevation,
  neutralises the coloured event blocks to white-with-a-bar, and lets the week
  grid expand (`overflow: visible`) instead of scrolling.
- `data-print-hide` marks the interactive chrome to drop in print: the app-shell
  and platform headers, the timetable view switcher, and the ICS subscribe
  button. The page's own heading and the schedule still print.

## Data & migration impact

None.

## Tests

- e2e (`print.spec.ts`): under emulated print media the app banner header is
  hidden while the page's `h1` stays visible; it returns on screen media. (This
  caught an early too-broad `header` selector that would have hidden the page's
  own content `<header>` too — now scoped to `data-print-hide`.)
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (24)
  pass; format applied.

## Verification steps

Open a section timetable and use the browser's Print preview: the nav, view
switcher, and subscribe button are gone; the heading and grid/list print on
white, and the grid shows all days without a scrollbar.

## Follow-ups

- The grid prints at its on-screen block sizes; a dedicated print-optimised
  layout (e.g. always list form) could be added later if desired.
