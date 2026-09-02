# chore(web): refresh the filled logo source and its assets

Targets `main`. Swaps in an updated `logo_filled.png` (the light-surface source)
and regenerates every asset derived from it. Assets only; no code change.

## What

- `assets/photos/logo_filled.png` replaced with the newer artwork (a teal disc
  with a white mark).
- Regenerated with `pnpm --filter web brand:assets` (the existing script, no
  change): `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`, and the
  manifest PNGs (`icon-192`, `icon-512`, `icon-maskable-512`), plus the light
  in-app mark `public/logo-mark-light.png`.
- `public/logo-mark.png` (the dark in-app mark, derived from `logo.png`) is
  unchanged, since only the filled source changed.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (26) pass. The branded-icon test in
  `landing.spec.ts` still holds (same filenames, new content).
- Verified in the browser, light and dark: the light sidebar shows the teal disc
  with a white mark, the dark sidebar shows the teal mark (unchanged), and the
  theme swap has no flash.

## Verification steps

Hard-reload `/u/lgu` (icons are cached): the browser tab favicon and the light
sidebar mark are the refreshed disc; toggle to dark for the teal mark.

## Follow-ups

None.
