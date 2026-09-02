# feat(web): steadier loading for avatars and directories

Targets `main`. Perceived speed only. No data, schema, or behaviour change.

## What

- **Avatars paint their backdrop immediately.** The generated illustration is
  fetched from the avatar route, so a directory used to fill in one avatar at a
  time as each SVG arrived. The `img` now carries its seeded backdrop colour as a
  background, so every circle is there on first paint and each illustration fills
  its own. The colour is the same one the SVG is drawn on, so nothing shifts.
- **Directory loading skeletons** for `/teachers` and `/rooms`: the heading, the
  search control, and a grid of cards at their real size, so the page does not
  jump when the names arrive.

## A note on where the boundary goes

The skeletons are on the two directory routes only, deliberately. A loading
boundary commits a 200 as soon as it starts streaming, so it must not sit above a
route that can still decide to return a 404. The directories cannot: the tenant is
already resolved by the layout. The profile routes can, since an unknown teacher
or room id calls `notFound()`, so they get no boundary and keep returning a real 404. Each `loading.tsx` says this, so the next person does not "helpfully" add the
missing pair.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass. The directory specs already cover that
  both routes render and filter, which is what a bad boundary would break.

## Verification steps

Open `/u/lgu/teachers` on a cold load: the circles appear together rather than one
at a time. Throttle the network and the skeleton shows at the real card size.
Request a teacher id that does not exist: still a 404, not a streamed 200.

## Follow-ups

None.
