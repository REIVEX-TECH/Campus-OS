# feat(web): generated OpenGraph images

Targets `main`. UI/SEO only; no schema or migration change, no new dependency.

## What

Shared links previously had no image on their social card. This generates one.

- `app/u/[slug]/opengraph-image.tsx`: a per-tenant 1200x630 card (brand dot in
  the tenant accent, the university name, and a tagline).
- `app/opengraph-image.tsx`: the platform landing's card.

Both use first-party `next/og` (`ImageResponse`) — server-only, nothing added to
the client bundle, no external asset, and the library's default Latin font (no
font file bundled). Next wires `og:image` and `twitter:image` from these file
conventions automatically, so every page now has a social image.

## Data & migration impact

None.

## Tests

- e2e (`seo.spec.ts`): the tenant home and the platform landing both expose an
  `og:image` pointing at `/opengraph-image`.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (21)
  pass; format applied. Verified in a prod build: both images return a 200
  `image/png` (~28-33 KB) and render correctly (viewed the generated cards).

## Verification steps

`curl -s .../u/lgu | grep og:image` shows the image URL; opening
`.../u/lgu/opengraph-image` (and `.../opengraph-image`) renders the card. Paste a
link into a social/preview tool after deploy to see the card.

## Follow-ups

- None. `docs/SEO.md` is updated to describe the images.
