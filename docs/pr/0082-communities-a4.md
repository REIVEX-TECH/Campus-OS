# feat(communities): A4, comments

Targets `main`. Communities **Phase A4** of `docs/design-communities.md`:
threaded comments under every post, on the A1 tables (materialised paths,
depth cap) and the A3 post page.

## What

**The thread** (`CommentThread`, server): the composer at the top for anyone
who may comment (a hint otherwise: sign in, or join), sort tabs (best, top,
new, old, controversial; the module sorts siblings, the page nests them), and
the tree. Each comment (`CommentNode`, client): a collapse rail that hides its
replies and text behind one line ("Expand 3 replies"), the author's mark and
handle or **Anonymous**, **OP** and **Mod** badges (never on an anonymous
comment: either would narrow the author), the time, "edited", the text or the
`[deleted]` / `[removed by moderators]` placeholder that keeps the tree, votes
(optimistic, one row per person), Reply (inline composer, withheld at the depth
cap with the reason on hover), Save, Report (reason picker), and for the author
Edit (inline) and Delete (confirm; replies stay).

**Composer**: text, an "Anonymously" option when the community and the tenant
allow it, one POST, the thread refreshes from the server.

**Post page**: the thread replaces the placeholder; the card's comment count
links to `#comments`. A locked post shows the thread and no composer.

**Routes**: `POST /api/communities/posts/{id}/comments` (a comment or a reply,
`parentId`); `POST /api/communities/comments/{id}` with one of `vote`, `save`,
`report`, `edit`, `delete`. Same gate, same refusal mapping as posts.

**Module**: `CommentView` gains `publicAuthorId` (null when anonymous),
`myVote` and `saved`, read by own-row joins in the one tree query; `PostView`
gains `publicAuthorId` so the page can compute OP without a second read.

## Data & migration impact

No schema change.

## Tests

- Integration (one new case): a root comment and an anonymous reply read back
  in tree order with depth; the viewer's vote and saved flag are theirs alone;
  the public author key is set for the signed comment and null for the
  anonymous one, whose author is null to everyone but `isOwn` to its author; a
  stranger sees no vote, no saved, no own; the replier's view of the thread
  never contains the anonymous author's id; the post's public author key is
  the OP reference. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 15 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, two new routes.
- e2e: the comment create and action routes are 401 to a stranger. `pnpm --filter web test:e2e`: 71 passed against a
  production build.
- Browser (local dev server, the post's author, who is also the owner): the
  post page shows the empty thread, the composer and the sort tabs; a comment
  appears with OP and Mod badges and the count reads 1 (the card's link points
  at `#comments`); Reply opens an inline composer and the reply nests under
  the root; collapsing the root hides the reply behind "Expand 1 replies";
  expanding and upvoting reads 1 and stays pressed; `?sort=new` marks the New
  tab and keeps the count and the vote.

## Verification steps

On a post: comment, reply to it (the reply nests), collapse the root (the
reply hides, the line reads "Expand 1 replies"), upvote a comment, save it,
edit your own, delete it (the placeholder keeps its replies), switch sort to
New; comment anonymously and confirm no OP badge and "Anonymous" as a second
person; a locked post (A6) shows no composer.

## Follow-ups

- A5: sorts for posts, Home and All feeds, hot on the community page.
- A6: moderator removal of comments (the placeholder is ready), lock and pin.
- Very long threads read in one query per page; a paged subtree read is a
  later change (design §12).
- Saved comments have no page yet; `/saved` lists posts only until B5.
