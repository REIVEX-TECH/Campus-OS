# feat(web): dark section select, loading skeleton, progressive picker

Targets `main`. Three timetable-picker fixes: the native Section select renders
in the dark theme, a skeleton shows while a section loads, and all three steps are
always visible (enabled in turn). No schema or migration change.

## What

- **Section select in dark mode** (`packages/ui/src/styles/globals.css`): the dark
  `--input` token was a translucent white overlay, which made Chrome fall back to
  a light popup for the native `<select>`. It is now an opaque dark grey, so the
  select and its option list render with the dark theme (the control already
  inherits `color-scheme: dark`). All filled fields keep their look; verified via
  computed styles.
- **Loading skeleton on navigation** (`_components/timetable-workspace.tsx` new,
  `timetable-picker.tsx`, `timetable/page.tsx`): a client workspace owns a
  `useTransition`; the picker runs its URL navigation inside that transition, so
  the results column shows a skeleton (and `aria-busy`) from the moment a choice
  is made until the new section's classes arrive. This is reliable where a server
  Suspense boundary is not, because a soft navigation holds the previous render
  during the transition, so an inner fallback would not appear on a param change.
- **Progressive enabling** (`timetable-picker.tsx`, `combobox.tsx`, `messages/en.ts`):
  Semester, Program, and Section are always visible. Program is disabled until a
  semester is chosen and Section until a program is chosen, each with a hint
  ("Choose a semester first" / "Choose a program first") wired to the control via
  `aria-describedby`. A disabled combobox renders a disabled native select showing
  its placeholder. This replaces the previous progressive reveal (fields appearing
  one by one).

## Data & migration impact

None.

## Tests

- e2e (`timetable.spec.ts`): a new test asserts the section step is disabled with
  its hint until a program is chosen, then enabled; another holds the soft-nav RSC
  fetch (fetch the response, deliver it after a delay) and asserts the results
  column becomes `aria-busy` (skeleton) during the load and clears after.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (28) pass; format applied.
- Verified in the browser, light and dark: all three steps visible with the
  disabled Section and its hint, the opaque fields, and the section timetable
  rendering after selection.

## Verification steps

Open `/u/lgu/timetable` in dark mode: the Section field and its dropdown are dark.
All three steps show; Section is disabled with "Choose a program first" until a
program is picked. Change the section on a slow connection: the results area shows
a skeleton until the new timetable loads.

## Follow-ups

- The timetable time/day/kind filter is the next PR.
