# feat(communities): b3, search and the directory

## What

Search across communities and posts, from the tenant's search box and from
the directory; and the directory itself grows sort orders (most members,
newest, A to Z) alongside the "Your communities" list.

## Why

The third thing a person does after joining and posting is looking for
something they half remember. The search box in the top bar already served
teachers and courses; now it serves the campus's conversation too, with the
same rules about who may see what.

## How

### Schema, `packages/modules/communities/drizzle/0003_search.sql`

Two expression GIN indexes, no new columns: `to_tsvector('simple', title ||
body)` on posts and `to_tsvector('simple', name || description)` on
communities. The query side builds the same expression over `posts_read`
(the view inlines to the table, so the planner matches the index) and over
`communities`. No column means nothing the app role could lose sight of and
no change to the views. `'simple'` because a campus writes in more than one
language.

### Module

- `src/search.ts`: `searchPosts(viewer, tenant, q)` reads through the same
  view, scope (public communities plus the viewer's joined ones) and viewer
  filters (hidden, blocked) as the feeds, so a search shows a person exactly
  what their feeds would; `websearch_to_tsquery` syntax (quoted phrases,
  excluded words); ranked by `ts_rank` then recency; empty below two
  characters; capped at twenty. `searchCommunities(tenant, q)` covers live,
  approved, public communities by name and description.
- `feed.ts` exports its `selectPosts`, `scopeWhere` and `viewerFilters` for
  that. `directory.ts` gains `listCommunities(tenant, limit, order)` with
  `members`, `new` and `name`.

### Web

- `/search` adds Communities and Posts sections under Teachers and Courses
  when the module is on; posts only for people the tenant's read access
  admits. The placeholder and intro say so.
- `/c/browse` gains a search field (a plain GET form, so a result is a URL)
  that shows matching communities and posts, and, when not searching, sort
  tabs over the full list.
- Strings: `search.communities`, `search.posts`, `feeds.searchCommunities`,
  `feeds.noResults`, `feeds.directory.*`.

## Security

Search is a read through the same view, scope and filters as the feeds, so it
cannot show a post the feed would not, and an anonymous post carries no
author here as everywhere; the integration case asserts a restricted
community's post appears only for its members and that a removed post never
appears. No new tables or policies; the RLS invariant is unchanged.

## Tests

- Integration (one new case): title and body both match, a removed post is
  never found, a one letter query finds nothing, a quoted phrase narrows to
  the exact match; a restricted community's post appears for a member and
  not for a stranger; results name their community and carry no author id;
  communities match by name, public and approved only; the three directory
  orders hold. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 27 passed, 1
  skipped (the column privilege test, split database only), with
  `0003_search` applied on setup. `pnpm --filter web build` clean.
- e2e (one new case): `/search?q=` and `/c/browse?q=` render for a
  stranger. `pnpm --filter web test:e2e` against a production build:
  81 passed on the first run, 81 passed on the second.
- Browser (local dev server, signed in): `/search?q=meetup` shows a Posts
  section with the poll post and the placeholder now reads "Search teachers,
  courses and communities"; `/search?q=freshers` shows Communities (CS
  Freshers) above Posts; `/c/browse?q=cs` keeps the query in the field and
  lists the matching community; `/c/browse?sort=name` marks A to Z among the
  three sort tabs.

## Verification steps

Run the migration (below). Type a word from a post title into the top bar's
search: a Posts section appears with the card; type a community's name: a
Communities section. Open Browse communities, search there, then clear it
and switch the sort tabs.

## Migration notes

`packages/modules/communities/drizzle/0003_search.sql`, applied by
`pnpm db:migrate:all`: two indexes, built without locking out writes for
tables this size. Rollback: drop the two indexes. Your step on the live
database.

## Breaking changes

None.

## Follow-ups

- Comments are not searched; the same expression index on `comments` and a
  Comments section are a small addition once there is call for it.
- Highlighting of the matched words in results (`ts_headline`) is deferred.
