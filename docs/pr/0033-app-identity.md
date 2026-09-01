# feat(web): app identity (favicon, app icon, manifest, theme-color)

Targets `main`. UI/metadata only; no schema or migration change, no binary
assets committed.

## What

The app had no branded icon, no manifest, and no mobile chrome colour (browsers
showed the framework default). This adds them.

- `app/icon.svg`: a scalable favicon (green rounded field, white "C" mark).
- `app/apple-icon.tsx`: a 180x180 iOS home-screen icon generated with `next/og`
  (matching mark), so no PNG is committed.
- `app/manifest.ts`: a web app manifest (name, description, `display: standalone`,
  background/theme colours, icons) for installable-PWA basics.
- Root `viewport.themeColor`: per-scheme `theme-color` (`#ffffff` light,
  `#0a0a0a` dark) for the mobile browser chrome.

## Data & migration impact

None.

## Tests

- e2e (`landing.spec.ts`): the page links a branded `icon.svg` and a manifest,
  and `/manifest.webmanifest` returns 200 naming CampusOS.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (22)
  pass; format applied. Verified in a prod build: `/icon.svg` (image/svg+xml),
  `/apple-icon` (image/png), and `/manifest.webmanifest` (application/
  manifest+json) all return 200, and the head carries both `theme-color` metas.

## Verification steps

Load any page: the browser tab shows the "C" favicon. `curl .../manifest.webmanifest`
returns the manifest; the head has `theme-color` for light and dark.

## Follow-ups

- Dedicated 192/512 PNG icons could be added if a full install prompt is desired;
  the scalable SVG covers the common cases today.
