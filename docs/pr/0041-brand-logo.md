# feat(web): brand the app with the logo (favicon, PWA, in-app mark)

Targets `main`. Replaces the placeholder identity with the real CampusOS logo:
the browser/app icons and a theme-aware in-app mark. No schema or migration
change.

## What

- **Two source logos**, committed under `assets/photos/`: `logo.png` (the teal
  mark on black, for dark surfaces) and `logo_filled.png` (the teal disc with a
  dark cut-out mark, for light surfaces). Both are 1254x1254 with no alpha.
- **Generation script** `apps/web/scripts/generate-brand-assets.mjs`
  (`pnpm --filter web brand:assets`), using `sharp` (Apache-2.0, now an explicit
  devDependency). It derives every asset from the two sources:
  - The black field becomes alpha exactly: a pixel is (facet colour x coverage)
    over pure black, so dividing by coverage recovers the teal with straight
    alpha and no dark fringe. The filled disc gets a circular alpha mask.
- **App icons** (from the filled disc): `app/favicon.ico` (16/32/48, transparent
  disc, crisp in the tab), `app/icon.png` (256, transparent), `app/apple-icon.png`
  (180, opaque), and `public/icon-192.png` / `icon-512.png` / `icon-maskable-512.png`
  for the manifest. Replaces the placeholder `icon.svg` and the `apple-icon.tsx`
  "C" mark; `manifest.ts` now points at the generated PNGs.
- **In-app logo mark**, theme-aware (`_components/logo-mark.tsx`): `logo-mark.png`
  (the teal mark) for dark, `logo-mark-light.png` (the teal disc) for light. Both
  render; CSS shows the right one for the theme class, which is set on `<html>`
  before first paint, so there is no swap flash. It is decorative (`alt=""`)
  everywhere because each spot pairs it with a text brand or an `aria-label`.
- **Placed** in the sidebar head (stays visible when the sidebar collapses, above
  the expand control), the mobile top bar, the platform landing header, and the
  timetable loader (a subtle pulse, gated by `prefers-reduced-motion`).

## Data & migration impact

None.

## Tests

- `landing.spec.ts` updated: asserts the branded `icon.png` / `apple-touch-icon` /
  manifest wiring (not the old `icon.svg`) and that every generated asset, both
  theme variants of the mark included, is served.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (26) pass; format applied.
- Verified in the browser, light and dark, desktop and mobile: the sidebar mark
  swaps disc (light) / mark (dark) with no flash (confirmed via computed
  `display`), the collapsed rail shows the mark above the expand chevron, the
  favicon/apple/manifest links resolve 200, and the manifest lists the icons.
  An adversarial a11y pass confirmed the collapsed-sidebar link keeps its
  accessible name and the loader mark is correctly hidden from assistive tech.

## Verification steps

Open `/u/lgu`: the sidebar shows the logo beside the tenant name (a filled teal
disc in light, the teal mark in dark). Toggle the theme: the mark swaps with no
flash. Check the browser tab: the favicon is the teal disc. Open `/`: the header
shows the mark beside "CampusOS".

## Follow-ups

- App icons are a single disc (not theme-switched); a filled teal disc reads on
  both light and dark browser and launcher chrome, and PWA/home-screen icons are
  single-variant anyway. The in-app mark is the theme-aware surface.
