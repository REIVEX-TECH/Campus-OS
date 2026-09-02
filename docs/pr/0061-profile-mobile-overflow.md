# fix(web): profiles no longer scroll sideways on a phone

Targets `main`. Layout only, but it fixes a real defect.

## What

The teacher and room profiles were 109px wider than a 375px screen, so course
titles, the free-slot intro, and the chips were all cut off at the right edge and
the page scrolled sideways.

The cause is a CSS default worth naming, since it is easy to reintroduce.
`truncate` sets `white-space: nowrap`, which makes an element's min-content width
the full width of its text. Grid and flex items default to `min-width: auto`, so
they refuse to shrink below that. The course link already carried `min-w-0`, but
its ancestors did not, so the floor was set two levels up and the whole card grew
instead of the title truncating.

`min-w-0` now runs the full chain: the courses card and the free-slots card as
grid items, and the course row as a flex container. The title truncates, its
class count stays visible, and the chips wrap.

## Data & migration impact

None.

## Tests

- e2e (2 new, 35 total): both profiles are opened at 375 by 812 and asserted to
  have `scrollWidth - clientWidth === 0`. This is the check that would have caught
  it, and it fails loudly if any future element sets a width floor again.
- `pnpm turbo run typecheck lint build test --filter=web` passes.
- Verified in dark mode on a phone viewport: zero overflowing elements, down from 44.

## Verification steps

Open a room or teacher profile at 375px: nothing is clipped and the page does not
scroll sideways.

## Follow-ups

None.
