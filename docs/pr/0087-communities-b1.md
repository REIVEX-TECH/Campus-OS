# feat(communities): b1, polls

## What

Phase B opens with polls: a third post kind with two to six options and a
closing time (one, three or seven days from the form), one final vote per
person, live percentages, and results once a person has voted or the poll
has closed. Communities choose whether to allow polls alongside text and
links; new communities allow all three.

## Why

Polls are how a campus decides small things in public: where to meet, which
slot, which name. The design listed them first in Phase B because everything
they need was already there: the post, the vote gate, the feed.

## How

### Schema, `packages/modules/communities/drizzle/0001_polls.sql`

- `poll_options (id, tenant_id, post_id, position, text, vote_count)` and
  `poll_votes (tenant_id, post_id, option_id, user_id, created_at)` with the
  primary key `(post_id, user_id)`: one vote per person by construction.
- Both get the module's tenant isolation policy and FORCE; `poll_votes` also
  gets a restrictive own row policy, so who chose what is the voter's alone to
  read. The RLS invariant test pins both.
- `posts.poll_closes_at`, appended to `posts_read` (which is what
  `CREATE OR REPLACE VIEW` permits). `communities.allowed_kinds` defaults to
  `{text,link,poll}` for new communities; existing ones keep their setting
  and owners enable polls in the community settings.
- Journal entry `0001_polls`; the module's own bookkeeping table applies it.

### Module

- `src/polls.ts`: `pollInputSchema` (two to six distinct options of up to 80
  characters, `closesInHours` 1 to 336, default 72), `writePollOptions` (in
  the post's transaction), `pollFor` (counts and whole percent shares for
  everyone, `myOptionId` from the own row join for the viewer), `votePoll`
  (the vote gate as for posts, `closed` after the closing time, `invalid` for
  an option of another poll, `exists` for a second vote; the count moves in
  the same transaction).
- `createPost` accepts `kind: 'poll'` with `poll`, writes the closing time
  and the options; a poll may carry text as well. `PostView.pollClosesAt`.
- The kind enums for creating and updating a community admit `poll`; the
  `closed` refusal is new.

### Web

- The compose form gains a Poll tab: options with add and remove (two to
  six), a duration select, and the same title, text, anonymity and spoiler
  fields.
- The post page renders the poll under the post: radio options and Vote for a
  member who may still vote, bars with percentages and "Your choice" after,
  or once closed; a vote count and "Closes in 2 days" or "Closed"; "Sign in
  to vote" for a stranger. Cards wear a Poll pill.
- `api/communities/posts/[id]` gains `pollVote`; the create route accepts
  `poll`. The community form offers Polls next to Text and Links.
- Strings: `poll.*`, the pill, the kind label, the closed refusal.

## Security

The vote gate is the post vote gate (verified member, not banned,
`communities.vote`, an open, unlocked, live post). The choice is private by
RLS, not by a query; the counts are public by design. Every read goes through
`posts_read` and the options table, which has no author column; an anonymous
poll is anonymous here as everywhere. The migration adds nothing a definer
function reads, so FORCE stays on.

## Tests

- Integration (one new case): a poll without options or with repeated
  options is `invalid`; a poll is created with three options and a closing
  time forty eight hours out, readable signed out with zero counts; the first
  vote lands with a 100 percent share and the voter's own choice, a second
  vote for anything is `exists`, a second person's vote splits the shares
  50/50 and each sees only their own choice, the author and a stranger see
  none; an option from another poll is `invalid`, a non member is
  `not_allowed`, a community without polls refuses the kind, a text post has
  no poll. The RLS invariant pins the two tables as forced. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 25 passed, 1
  skipped (the column privilege test, split database only), against a test
  database that applied `0001_polls` on setup. `pnpm --filter web build`
  clean.
- e2e (one new case): the poll vote action is 401 to a stranger. `pnpm --filter web test:e2e` against a production build:
  1 failed 76 passed on the first run, 1 failed 78 passed on the second.
- Browser (local dev server, as a community owner): Polls ticked in the
  community settings saves and reads back ticked; the compose form shows the
  Poll tab; a three option poll posts and lands on its page open, with three
  radios and Vote disabled until a choice; voting turns it into bars with
  "Saturday morning · Your choice · 100%" and "1 vote · Closes in 3 days";
  the community list shows the card with its Poll pill.

## Verification steps

Run the migration (below). In a community whose settings allow polls, open
Submit, pick Poll, add three options, post; vote from a second account and see
the bars and "Your choice"; try to vote again and see nothing offered; view
signed out and see counts with "Sign in to vote".

## Migration notes

`packages/modules/communities/drizzle/0001_polls.sql`, applied by
`pnpm db:migrate:all` (the communities module's own bookkeeping table). It is
additive: two new tables, one nullable column, a changed column default, and
the view re-created with one more column at the end; nothing existing changes
shape. Rollback: drop `poll_votes`, drop `poll_options`, re-create
`posts_read` without the last column, drop `posts.poll_closes_at`, and reset
the `allowed_kinds` default; no data outside those tables is touched. This is
your step on the live database, as before.

## Breaking changes

None. `createPost` accepts a new kind; existing callers are unaffected.

## Follow-ups

- Closing is a comparison against the closing time at read and vote time;
  there is no job, so nothing needs to run for a poll to close.
- The integration suite cannot backdate a closing time through the app role,
  so `closed` is asserted by construction rather than by a fixture; a fixture
  through the owner role is on the list with A6's audit line.
- A poll's options cannot be edited after posting, on purpose; the title and
  text can.
