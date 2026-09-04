# feat(communities): b4, flairs, pinned order, crosspost, share

## What

Four small Reddit shapes: post flairs a community defines and a post wears
(and a list filters by); the pinned order under a moderator's hand; a
crosspost into another community that points back at the original; and
Share on every card through the device's share sheet, with copy as the
fallback.

## Why

Flairs are how a community sorts itself without moderators; pins in the
right order are how it speaks; a crosspost is how a good post travels
without being copied; and a share sheet is how it leaves the app. Each was
waiting on a table or a column that already existed, save one.

## How

### Schema, `packages/modules/communities/drizzle/0004_crosspost.sql`

`posts.crosspost_of uuid` (set null when the original goes), a partial
index, and `posts_read` re-created with the column appended. Flairs use
`post_flairs` and `posts.flair_id` from A1; pins use `pinned_at`.

### Module

- `src/flairs.ts`: `listFlairs`, `setFlairs` (the set by id: renamed flairs
  keep their posts, dropped ones let go through `ON DELETE SET NULL`; names
  unique within a community; up to twenty; logged as `flairs.updated`),
  `flairBelongs` for the post gate.
- `createPost` takes `flairId` and refuses one from another community; the
  insert is split into `createPostIn(tx, …)` so a crosspost can run inside
  its own transaction through the same gate. `PostView` gains `flairId`,
  `crosspostOf` and `crosspost`; `attachCrossposts` fills the original's
  title and community in one batched query and only for a public, live
  original (a restricted community's post does not travel by title). Feeds,
  the post page, search and the saved list attach it.
- `feed.ts`: `flairId` filters a community's list.
- `src/crosspost.ts`: the source must be visible to the person (public, or
  a community they belong to), the target must differ, one crosspost of an
  original per community, and crossposting a crosspost points at the
  original.
- `mod-actions.ts`: `movePin` swaps pin times with the neighbour (a
  millisecond nudge when they tie) and logs `pin_order`.

### Web

- Community settings: a Flairs editor (name, one of seven colours). Compose:
  a flair select when the community has any. The community page: flair pills
  as a filter row over the sort tabs; cards wear their flair as a pill that
  links to the filter.
- The post page: Crosspost, with a select of the person's other communities
  that allow text posts; the new post opens. Cards of crossposts carry a
  pill and "Crossposted from {community}" linking to the original.
- Mod tools: a Pinned tab listing the pins in order with up, down and unpin.
- Share replaces Copy link: the Web Share API where it exists, the clipboard
  otherwise, the same "Link copied." status.
- `api/communities/[id]/flairs`; `crosspost` on the post action route;
  `pinMove` on the mod route. Strings: `flairs.*`, the crosspost lines, the
  pinned tab.

## Security

The crosspost goes through the target's full post gate (membership, kind,
limits, filters) and the original's visibility is checked as the person
before anything is read for them; the attached original is named only when
public, so a title never leaks out of a restricted community. Flair writes
need `communities.manage` or oversight; pin order needs moderation. No new
policies; the RLS invariant is unchanged.

## Tests

- Integration (three new cases): flairs refused to a member, duplicate names
  refused, the set saved with colours normalised and positions, another
  community's flair refused on a post, a worn flair read back and filtered
  by, a rename by id kept on the post, a drop taking it off; pins reordered
  up and down with the edges staying put, moderators only, an unpinned post
  not found, the log naming each move; a crosspost refused into its own
  community, from a restricted origin a stranger cannot see, by a non member
  of the target, and a second time; the new post names its original in the
  post page and the feed; a crosspost of a crosspost points at the original;
  a removed original leaves the pointer bare. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 30 passed, 1
  skipped (the column privilege test, split database only), with
  `0004_crosspost` applied on setup. `pnpm --filter web build` clean.
- e2e (one new case): the flairs route and the crosspost action are 401 to a
  stranger. `pnpm --filter web test:e2e` against a production build:
  82 passed on the first run, 82 passed on the second.
- Browser (local dev server, signed in as an owner who also holds tenant
  oversight): a flair "Question" saves from the community settings ("Flairs
  saved."); a post composed with it lands with the flair pill linking to the
  filter, Share in the actions; the community page shows the filter row (All,
  Question) and the filter lists the flaired post alone once pins honour it (a
  fix made during this pass); Mod tools, Pinned lists the pinned post with up,
  down and Unpin; after joining a second community the post page offers
  Crosspost, and the new post in that community reads "Crossposted from CS
  Freshers" with the Crosspost pill.

## Verification steps

Run the migration (below). In a community's settings add two flairs; compose
a post wearing one and see its pill and the filter row on the community
page; pin three posts and reorder them from Mod tools, Pinned; open a post
and crosspost it into another of your communities; press Share on a phone.

## Migration notes

`packages/modules/communities/drizzle/0004_crosspost.sql`, applied by
`pnpm db:migrate:all`: one nullable column, one partial index, the view
re-created with one more column at the end. Rollback: re-create the view
without the last column, drop the index and the column. Your step on the
live database.

## Breaking changes

None. `createPost` accepts an optional `flairId`.

## Follow-ups

- User flairs (`user_flairs` from A1) are still unused; a member's badge per
  community is B6 material.
- Feeds outside a community show a flair pill only when the page has the
  community's flairs; the All and Home feeds do not yet fetch them.
