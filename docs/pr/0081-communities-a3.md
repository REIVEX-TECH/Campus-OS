# feat(communities): A3, posts

Targets `main`. Communities **Phase A3** of `docs/design-communities.md`: text
and link posts on the A1 tables and the A2 pages. Voting is on the card too,
because the module already had it and a Reddit card without its column is not
one; the sorts, the Home and All feeds and the ranking pages remain A5.

## What

**Compose** (`/c/{slug}/submit`): text or link tabs (as the community allows),
title, text or URL, "Post anonymously" with the disclosure every time, a spoiler
mark. Signed in to see it; a member holding `communities.post` to send it,
otherwise the page offers Join. On success it lands on the post.

**Permalinks** `/c/{slug}/post/{id}/{title-slug}`: the id is looked up, the
title tail is for people and search engines, so a renamed post's old link still
lands. The page shows the post in full, its comment count (comments are A4;
the area says so), and the community's rail.

**The card** (`PostCard`): the vote column (up, score, down; optimistic, the
server's tally replaces it; shown but inert signed out), the meta line
(community when outside it, the author's handle and mark or **Anonymous**, the
relative time, an "edited" link to the history, a spoiler badge), the title,
the text (three lines in a list, all of it on the page; a spoiler's text behind
"Show" in a list) or the link (its domain, `rel="noopener noreferrer
nofollow"`, a new tab), and the actions: comments, copy link, save, hide,
report with a reason picker and an optional note, and for the author edit and
delete (with a confirm). Nothing on an anonymous card narrows the author: no
handle, no mark, no OP badge.

**Community page**: the posts newest first, twenty-five a page with a "More
posts" link carrying an opaque keyset cursor (no infinite scroll, no nested
scroll region), a "New post" button for members who may post, and honest empty
states.

**Edit** (`/post/{id}/edit`, the author only, 404 to anyone else): title and
text; the previous text is kept. **History** (`/post/{id}/history`): what the
post said before each edit, with no author on it. **Saved** (`/saved`): the
viewer's saved posts, newest saved first, private.

**Routes**: `POST /api/communities/{id}/posts` creates; `POST
/api/communities/posts/{id}` takes one of `vote`, `save`, `hide`, `report`,
`edit`, `delete` through the one communities gate, the module deciding each
inside its transaction (votes and reports keep their own limits).

**Module**: `feed.ts` (`listCommunityPosts`, keyset on `(created_at, id)`,
per viewer vote and saved flags, the viewer's hidden posts filtered in the
query, opaque cursors), `saved.ts` (save and hide toggles, the saved list),
`postHistory`, and `PostView` gains `myVote`, `saved` and `community`. Every
read still goes through the owner views; the joins to votes and saved items
are own-row tables, so a stranger's joins yield nothing.

## Data & migration impact

No schema change.

## Tests

- Integration (two new cases): three posts page as `[Three, Two]` then `[One]`
  with a working cursor and the community named on each; hiding one removes it
  for the viewer alone and a stranger still sees three; an unknown item cannot
  be hidden; a voter's `myVote` and `saved` are theirs and nobody else's, the
  saved list is the viewer's, unsaving empties it, editing keeps the previous
  title and text in a history that carries no author, and the post shows as
  edited. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 14 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, five new routes.
- e2e: `/c/<unknown>/submit` is 404; the post action route is 401 to a
  stranger. `pnpm --filter web test:e2e`: 70 passed against a
  production build; `pnpm --filter web build` clean.
- Browser (local dev server, the community's owner): the compose page renders
  the Text and Link tabs, the anonymous toggle with its disclosure and the
  spoiler mark; a text post lands on its permalink with the vote column, the
  author's handle, "2 seconds ago", the title, the text and every action;
  Upvote reads 1 and stays pressed; Save reads Saved and `/saved` lists the
  post; the edit page saves a new title, the permalink shows "edited" and
  the history page shows the previous title; the community page lists the
  card with the New post button and the edited marker.

## Verification steps

As a member of a community: New post → text → it opens at its permalink;
upvote it, save it, `/saved` lists it; edit it, the card reads "edited" and the
history page shows the old text; post a link, the card shows its domain and
opens it in a new tab; post anonymously, sign in as someone else, the card reads
Anonymous with no mark.

## Follow-ups

- A4 comments on the post page; A5 sorts, Home and All, ranking on the cards;
  A6 removal, lock and pin on the same card.
- Flair on posts waits for B4's flair management.
- Link posts show the domain and never fetch the page; unfurled titles and
  previews would need a fetcher with its own safety rules, deferred.
