# feat(web): anonymous-visible engagement teasers under the timetable

Almost all timetable traffic is signed out (100+ unique visitors a day, near-zero
sign-ups), and the contextual chips only render for signed-in users, so the busiest
page on the site shows an anonymous visitor nothing to do next. This adds a compact
"what's on right now" strip under the schedule, populated from real data, visible to
every viewer.

## What

A strip below the schedule (above the footer) with up to three tiles, each a link to a
page that is already public to browse:

1. the latest post in the tenant's confessions community (title + snippet),
2. the newest lost-and-found item that has a photo (thumbnail),
3. the newest active marketplace listing under Rs 5000 (thumbnail + price).

A tile with no data is dropped; the lost-and-found tile is dropped unless the item has a
photo (the thumbnail is the point). When all three are empty the whole strip renders
nothing. On mobile the tiles scroll horizontally. Nothing here needs a session, so it
renders server-side for anonymous visitors.

"Confessions" is not a first-class concept in the platform, so the confession tile
resolves to the community whose slug is `TEASER_CONFESSIONS_SLUG` (default `confessions`);
if that community does not exist or has no post, the tile is simply absent. No tenant is
hardcoded (CLAUDE.md §2.3): the slug is configurable and every tile is gated on the
module being enabled for the tenant.

## Changes

- `apps/web/lib/timetable-teasers/tiles.ts` (new) — the pure tile shaping (`buildTeaserTiles`,
  `TeaserTile`, `TeaserInput`, snippet truncation and the drop rules). No database, no
  module code, so it is unit-testable in isolation, matching the `lib/cards` / `lib/chips`
  split.
- `apps/web/lib/timetable-teasers/index.ts` (new) — the fetch layer: reads the three picks
  through the modules' own public read functions (`communityBySlug` + `listCommunityPosts`,
  `listItems`, `listListings`) and hands them to the pure builder. Cross-module composition
  lives in the app layer, never module-to-module (CLAUDE.md §4).
- `apps/web/app/_components/timetable-teasers.tsx` (new) — the strip (server component).
  Renders nothing when there are no tiles. Each tile carries `data-teaser-strip` /
  `data-teaser-tile` so view/click can be instrumented later without a redesign (see
  Follow-ups).
- `apps/web/app/u/[slug]/timetable/layout.tsx` — fetch the teasers in the existing cascade
  `Promise.all` and render the strip below the grid, above the provenance line.
- `apps/web/messages/en.ts` — four `teaser.*` strings (heading + the three tile labels).
  All user-facing copy goes through i18n (CLAUDE.md §5).

## Data & migration impact

No schema change. Reads existing tables (`communities` / `posts`, `lf_items` /
`lf_item_photos`, `mkt_listings`) through the modules' existing repositories, which set the
tenant context; the reads are the same ones the public browse pages already run.

## Tests

- `apps/web/test/timetable-teasers.test.ts` (new, 9 cases) — the pure builder: empty in →
  empty out (strip hidden), tile order, each tile's public link, thumb-key to media URL,
  the lost-and-found no-photo drop, marketplace kept with a null thumb, a free (Rs 0) tile
  kept, and snippet truncation / whitespace collapse / null body.

Run: `pnpm --filter web test` (full web unit suite, 180 passing incl. these 9).

## Verification steps

- `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`
- Load `/u/lgu/timetable` signed out. With no qualifying data the strip is absent and the
  page is unchanged. **Verified live** against the dev DB: with a confessions community
  present the strip renders the "Only on CampusOS" heading and a confession tile linking to
  `/u/lgu/c/<community>/post/<id>/<title-slug>`, while the empty lost-and-found and
  marketplace tiles are correctly dropped (one tile shown); the empty-data case renders no
  strip; mobile (375px) lays the tile out full-width; no console errors.

## Follow-ups

- **Instrumentation is deferred, on purpose.** The task asked to record strip/tile
  view + click into `platform_events` (kind `timetable_teaser.*`) keyed on an anonymous
  session id. There is no `platform_events` table and no anonymous visitor identifier
  today, and an unauthenticated write endpoint keyed on a client-set id is exactly the kind
  of forgeable-write / privacy surface CLAUDE.md §6 and §8 say not to improvise same-day.
  The tiles already carry `data-teaser-*` hooks; the anonymous-safe design (a signed,
  rate-limited visitor cookie; an append-only events table with RLS; no PII) is a small
  follow-up PR, not a rushed addition here.
- The sign-in landing fix (return the visitor to the timetable they were viewing instead of
  the tenant home) ships as its own PR.
