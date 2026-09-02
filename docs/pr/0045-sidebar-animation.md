# feat(web): animate the sidebar open and close

Targets `main`. Smooths the sidebar transitions. CSS only; no schema or behaviour
change.

## What

- **Mobile drawer close** (`globals.css`): the drawer already slid in on open, but
  on close it vanished because `visibility: hidden` applied instantly. The
  visibility flip is now delayed to the end of the slide (`visibility 0s linear
0.2s`), so the drawer slides out; on open, `is-open` keeps visibility immediate
  so focus can still move into the drawer.
- **Desktop collapse/expand** (`globals.css`): the rail width (`--sidebar-w`,
  driven by `grid-template-columns` on `.app-shell`) now transitions over 0.2s, so
  collapsing and expanding animate instead of snapping. Browsers without animatable
  grid tracks simply snap.
- **Reduced motion**: `.app-shell` is added to the `prefers-reduced-motion` block,
  so neither transition animates when the user asks for less motion.

## Data & migration impact

None.

## Tests

- No new tests (CSS transition only). The drawer open/close, focus containment,
  and collapse toggle are already covered by `shell.spec`, which still passes.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (28) pass; format applied.
- Verified the applied transitions via computed styles: `.app-shell` transitions
  `grid-template-columns 0.2s`; the mobile `.app-sidebar` transitions
  `transform 0.2s, visibility 0s linear 0.2s`.

## Verification steps

On desktop, toggle the sidebar collapse: the rail width animates. On a phone,
open and close the drawer: it slides both ways. With reduced motion enabled,
both are instant.

## Follow-ups

None.
