# feat(web): tenant module hub with Coming soon stubs

Targets `main`. Pure UI over the existing tenant shell; no schema or migration
change, no auth, no new data.

## What

The tenant home (`/u/[slug]`) becomes a module hub: a compact, full-width grid
of module cards. Live modules link to their real pages; future modules are
"Coming soon" stubs — UI only, no feature and no data behind them.

- **Catalogue.** `lib/modules.ts` lists the modules (icon, i18n key, and either a
  live `path` or `soon: true`). Live: Timetable, Free rooms, Search. Soon:
  Marketplace, Communities, Lost and found, Rides, Campus map. `soonModule(key)`
  validates the stub route. This is a UI catalogue, deliberately separate from the
  real module registry (`packages/modules/*` manifests).
- **Hub.** The tenant home renders the cards; live cards go to `${base}${path}`,
  soon cards to `${base}/soon/${key}` and carry a "Coming soon" pill.
- **Coming soon page** `/u/[slug]/soon/[module]`: a centred, iOS-clean state
  (icon, label, description, pill, back link). `soonModule` gates it —
  `notFound()` for a live module key (e.g. `timetable`) or an unknown key.
- **i18n.** `module.<key>.label` / `.desc` for all eight modules, plus
  `modules.comingSoon` / `modules.soonBody` / `modules.back`.

No community/marketplace/etc. features are built — these are stubs only, by
design; those modules are a separate design session.

## Data & migration impact

None. No schema change, no new tables, no data collection.

## Tests

- e2e (`e2e/modules.spec.ts`): the hub links live modules to their pages and opens
  a soon stub for a future module (with a working back link); a live/unknown
  `/soon/<key>` returns 404.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (15) pass
  locally; format applied.

## Verification steps

Open `/u/lgu`: three live cards (Timetable, Free rooms, Search) and five
"Coming soon" cards. Click a Coming soon card → clean stub with a back link.
Visit `/u/lgu/soon/timetable` → 404. Toggle dark mode; both hold in light + dark.

## Follow-ups

- SEO PR enumerates the `/soon/*` stubs (and the hub) in the sitemap as it sees fit.
- When a real module ships, flip its `soon` to a `path` in `lib/modules.ts`.
