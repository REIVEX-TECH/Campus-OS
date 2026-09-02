# feat(web): illustrated generated avatars

Targets `main`. Replaces the initials-in-a-circle marks with proper illustrated
avatars. Deterministic, no photographs, and nothing inferred from a name.

## What

- **DiceBear**, rendered on the server. People get **Notionists**, a hand drawn
  character style; rooms get **Shapes**, an abstract mark, because a face on a
  lecture hall reads as a mistake. Both are seeded by entity id, so one teacher
  always resolves to one picture, everywhere.
- **Licences, checked before adding** (CLAUDE.md 2.5): `@dicebear/core` MIT,
  `@dicebear/collection` MIT, the Notionists artwork **CC0 1.0** (Zoish), Shapes
  MIT. Nothing here needs attribution at runtime.
- **A cached route, not inline SVG.** Each illustrated avatar is roughly 11KB, so
  a directory of twenty would add hundreds of KB to the HTML on every load.
  `/api/avatar/[kind]/[seed]` renders it once and returns
  `cache-control: public, max-age=31536000, immutable`, which is honest because
  the output is a pure function of the seed. The client ships no avatar code at
  all, and the same component works from server and client trees.
- Inputs are validated with zod: unknown kinds and unsafe or overlong seeds are
  404, so the cache key stays bounded.
- Theme aware by construction: every avatar sits on its own seeded backdrop from
  the existing palette, so it reads on light and dark without a variant.

## Data & migration impact

None. Avatars are generated, never stored.

## Tests

- Unit (6): determinism, palette bounds, that people and places differ for the
  same seed, and seed escaping.
- e2e (1 new, 33 total): the route returns a cacheable SVG, the same seed returns
  byte identical output, a different kind differs, and a bad kind or overlong
  seed is refused. The two profile specs now assert the cached image rather than
  an inline drawing.
- `pnpm turbo run typecheck lint build test --filter=web` passes.
- Verified in the browser: ten distinct character avatars on the teacher
  directory in dark, fifteen distinct room marks in light.

## Verification steps

Open `/u/lgu/teachers` and `/u/lgu/rooms`: every entity has its own picture, and
reloading gives the same ones. `curl -I /api/avatar/person/abc` shows the
immutable cache header.

## Follow-ups

- `@dicebear/collection` pulls every style, but it is imported only by the route
  handler, so nothing reaches the client bundle. If server bundle size matters
  later, depend on the two style packages directly.
- Removed `roomInitials`, which existed only to letter the old room tiles.
