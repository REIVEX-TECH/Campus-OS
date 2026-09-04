# feat(communities): a5, sorts and feeds

## What

Communities A5: the five sorts (Hot, New, Top with a time window, Rising,
Controversial) on every list of posts, a Home feed of the communities a person
joined and an All feed of everything public in the university at `/c`, a
"Rising now" rail, keyset cursors that carry the sort key, and a `/c/browse`
page that takes over the directory.

Voting itself, the precomputed ranking columns and the first cursor landed in
A3; this PR reads them every way the design promised.

## Why

A community is a stream, not a list. Reddit's sorts are the reason a feed stays
worth opening: Hot for the room, New for the regulars, Top for a week you
missed, Rising for what is about to matter, Controversial for the arguments.
Home and All are the difference between a notice board and a campus.

## How

- `packages/modules/communities/src/feed.ts` is rewritten around one reader,
  `listPosts(viewer, tenant, scope, options)`. A scope is a community, All (a
  subquery over public, approved, live communities) or Home (a subquery over
  the viewer's open memberships; signed out, Home is empty by construction).
  Each sort is a plan: an index order, a keyset continuation and the cursor of
  a row. Hot orders by `(hot_score, id)`, New by `(created_at, id)`, Top by
  `(score, created_at, id)` inside the window, Controversial by
  `(controversy, id)`; Rising is the one read time computation (score per
  hour of age, floored at half an hour) bounded to the last day and served as
  a single page with no cursor. Cursors are base64url of the sort key parts; a
  cursor of the wrong arity is ignored rather than trusted. Removed, deleted
  and hidden posts are excluded in every sort. `listCommunityPosts` stays as a
  thin wrapper (now Hot by default) and `trendingPosts` feeds the rail.
- `apps/web/app/u/[slug]/c/page.tsx` becomes the feed: Home and All tabs (Home
  only when signed in), sort tabs, a window row under Top, the cards with their
  community named, a "More posts" link that preserves the whole state, empty
  states that point at the directory, and a rail with the person's
  communities, what is rising and the platform rules.
- `apps/web/app/u/[slug]/c/browse/page.tsx` holds the directory that used to
  live at `/c` (yours, all). Search and discovery proper are B3.
- `apps/web/app/_components/communities/feed-tabs.tsx`: the tabs are links.
  Every state is a URL, so the back button and a shared link both mean
  something, and nothing here needs a client component.
- The community page gains the same sort tabs and window row and passes
  `sort`, `t` and `after` through its "More posts" link.
- Strings: the `feeds.*` block.

The lists are pages. There is no infinite scroll and no nested scroll region.

## Security

No new tables, policies or definer functions. Every read goes through the
existing `posts_read` view, so an anonymous post's author is null in every
sort and every feed; the own row joins for votes and saved items yield the
viewer's rows and nobody else's, as before. The All feed excludes restricted
communities by construction, not by a UI check. RLS is untouched.

## Tests

- Integration (two new cases): a community with votes reads in the expected
  order under all five sorts, Top's second page continues from the cursor of
  the first, a cursor from another sort is ignored, and Rising has no cursor;
  Home is empty until a person joins and then holds that community's posts,
  All carries public posts and never a restricted community's, a restricted
  community's member sees it at Home, every card names its community, the
  rising list is tenant wide, and another tenant's feed is empty.
  `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 17 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, one new route.
- e2e (one new case): a sorted All feed and the browse page are 200 and ask
  for a sign in. `pnpm --filter web test:e2e`: 72 passed against a
  production build.
- Browser (local dev server, signed in): `/c` opens on Home in Hot with the
  joined community's post, the card names its community, the rail shows Your
  communities and Rising now; `?feed=all&sort=top&t=week` marks All, Top and
  This week and the other tabs link to the right URLs (Hot drops the sort
  param, the window links keep `feed` and `sort`); a community page carries the
  sort tabs without the feed tabs and `?sort=new` marks New; `/c/browse` shows
  the directory with a link back to the feed.

## Verification steps

Signed in on a tenant with the module: open `/u/<slug>/c`; switch Home and
All, run through the sorts, pick a window under Top, follow "More posts" when
a feed is longer than a page and confirm the order continues; open a community
and do the same; open `/u/<slug>/c/browse`. Signed out, `/c` shows All only.

## Migration notes

No schema change.

## Breaking changes

None. `/c` now shows feeds; the directory moved to `/c/browse` and is linked
from the header and the empty Home state.

## Follow-ups

- The Top window test covers inclusion only; excluding an older post needs a
  backdated `created_at`, which the integration suite cannot write through the
  app role. A fixture through the owner role can come with A6's tests.
- Rising ranks at read time with a day bound; if a tenant's day exceeds a few
  thousand posts this becomes a materialised column refreshed by a job.
- The community name on a card in a feed is text; B5 makes it a link with the
  icon.
