# fix(web): make the week grid keyboard-scrollable

Targets `main`. Accessibility only; no schema or migration change.

## What

On narrow screens the flagship week grid scrolls horizontally inside its own
container, but that container was a plain `<div class="overflow-x-auto">` with no
keyboard access, so keyboard-only users could not scroll to later days (WCAG
2.1.1 Keyboard). It is now a proper scroll region:

- `role="region"` with an `aria-label` (i18n `timetable.weekGrid`) so screen
  readers announce it and its purpose.
- `tabIndex={0}` so it is reachable and arrow-key scrollable.
- a visible focus ring (`focus-visible:ring-2`).

## Data & migration impact

None.

## Tests

- e2e (`section-views.spec.ts`): in Grid view the grid is a visible `region`
  named "Weekly timetable grid …" with `tabindex="0"`.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (22)
  pass; format applied.

## Verification steps

Open a section timetable in Grid view on a narrow viewport, Tab to the grid, and
scroll it with the arrow keys; a focus ring shows while it is focused.

## Follow-ups

- None.
