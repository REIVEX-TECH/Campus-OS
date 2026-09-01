# feat(web): full-width platform landing

Targets `main`. UI only; no schema or migration change, no new data.

## What

The platform landing (`/`, served on the platform host, e.g.
`campusos.reivex.io`) becomes a real full-width landing instead of a narrow
centred card list.

- **Header.** New `PlatformHeader` (sticky, frosted, no divider): brand, a GitHub
  link, and the theme toggle. The platform host previously had no way to switch
  theme; now it does, matching the tenant AppShell.
- **Hero.** Headline, one-line value statement, a primary "Browse universities"
  action (anchors to the list) and a GitHub action.
- **Features.** Four compact value-prop cards (live timetables; find rooms and
  classes; modular by design; free and open-source), full-width grid.
- **Universities.** The tenant list as a card grid linking to each instance
  (host-reflective URLs, path-based in dev).
- Copy added to i18n (`platform.hero.*`, `platform.feature.*`,
  `platform.features.heading`).

The **tenant** landing (`lgu.campusos.reivex.io`) is the module hub shipped in
the previous PR, which is already full-width, compact, and theme-aware.

## Data & migration impact

None.

## Tests

- e2e (`e2e/landing.spec.ts`): the landing renders the hero, a feature card, and a
  university link, and the GitHub link is `rel=noopener`.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (16) pass
  locally; format applied.

## Verification steps

Open `/` on the platform host (localhost in dev): hero, four feature cards, and a
universities grid. Click "Browse universities" (scrolls to the list) and a
university card (opens the tenant). Toggle theme; both hold in light + dark.

## Follow-ups

- SEO PR gives the platform landing its OpenGraph/Twitter metadata and JSON-LD.
