# feat(web): timetable form-left/results-right, sorted + searchable picker

Targets `main`. PR 2 of the UI redesign (the timetable page). No schema or
migration change.

## What

- **Form left, results right**: within the content, the picker sits in a compact
  left column and the selected timetable renders to its right (`lg` and up);
  below that they stack. Wrapped in `PageShell` with an `xl`-only rail.
- **Sorted Semester**: `listTermsWithSections()` now sorts numeric-aware by name,
  so the dropdown reads 1st, 2nd, ... 10th instead of the crawl's insertion
  order. Programs stay ordered by code.
- **Searchable comboboxes** for Semester and Program (`_components/combobox.tsx`):
  a WAI-ARIA editable combobox — type to filter, ArrowUp/Down to move, Enter to
  pick, Escape to close, click-outside to dismiss. Before hydration (and with JS
  disabled) it renders the native `<select>` and enhances on mount, so there is
  always a keyboard-usable control. Section stays a native select (short list).
  No new dependency.
- **Right rail** (`xl`): "free rooms right now" (computed for the tenant's current
  time) plus quick links to free rooms and search.
- **No inner grid scrollbar**: the week grid's `overflow-x-auto` scroll region and
  fixed min-widths are removed; the columns flex to fill the results column, so
  the page scrolls and no panel does. On a phone the responsive default is the
  list view.

## Data & migration impact

None. The sort is a comparator; no schema change.

## Tests

- Integration: `listTermsWithSections()` sorts ordinal-named terms 1st → 10th.
- e2e: the Semester combobox filters and is keyboard-operable (`timetable.spec`);
  the picker cascade and section views are driven deterministically by URL (the
  picker options are still read from the combobox / native select), and the grid
  is detected by class-block count rather than a fresh-navigation visibility probe
  (which the nested app-shell + PageShell grids make unreliable in Playwright —
  the same reason `print.spec` now asserts the heading via text/display).
- `pnpm turbo run typecheck lint build`, module integration (28), and
  `pnpm --filter web test:e2e` (26) pass; format applied.
- Verified visually (light + dark, wide desktop): form left / results right, the
  sorted Semester value, the combobox, the grid filling its column with no
  horizontal scrollbar, and the free-rooms-now rail.

## Verification steps

Open `/u/lgu/timetable`: the picker is on the left, the timetable on the right;
the Semester list is in 1st→8th order and filters as you type; the week grid
fits its column with no scrollbar; on a wide screen the rail shows free rooms now.

## Follow-ups

- PR 3: compactness pass and rolling `PageShell` (contextual rails) across the
  remaining tenant pages.
