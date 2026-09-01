# feat(web): platform-landing SEO

Targets `main`. Read-only; no schema or migration change, no new data.

## What

The platform landing (`/`, served on the platform host) was the one public page
without full metadata: it inherited only the static root title. This gives it
the same treatment every tenant page already has.

- `generateMetadata()` on the platform root: canonical URL, OpenGraph, a Twitter
  `summary_large_image` card, and `metadataBase`, all host-reflective.
- A `WebSite` JSON-LD node (`lib/json-ld.ts` `websiteLd`) rendered on the
  landing.

Every public page now carries canonical + social metadata; the platform landing
and tenant home both carry structured data.

## Data & migration impact

None.

## Tests

- e2e (`seo.spec.ts`): the platform landing carries `WebSite` JSON-LD, an
  `og:title` of `CampusOS`, and a `summary_large_image` Twitter card.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (19)
  pass; format applied.

## Verification steps

View source on `/` (platform host): `<link rel="canonical">`, `og:*`,
`twitter:*`, and a `"@type":"WebSite"` JSON-LD block.

## Follow-ups

- OpenGraph image generation (`next/og`), shared with the tenant pages, once a
  brand asset exists.
