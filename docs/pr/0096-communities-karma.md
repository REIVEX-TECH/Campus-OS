# feat(communities): karma that cannot be given to yourself

## What

Communities C1, and addendum item 4. Karma stops being a live sum of a person's
item scores and becomes a materialised pair of totals, moved by the vote that
causes them and rebuildable from the votes. An author's vote on their own item
is refused. One account can move another's karma only so far in a day. What an
anonymous item earns is the author's, and stays out of the number anyone else
can see.

## Why

The old number was `sum(score)` over a person's live signed items. Three things
were wrong with it, and all three were ways to make it say what you wanted:

- It counted an author's vote on their own post, and nothing refused one.
- It counted a hundred votes from one account exactly like a hundred votes from
  a hundred accounts, so a pair of accounts could inflate each other and one
  account could bury someone.
- It could not include an anonymous item at all, because the column that would
  attribute one is a column the application role may not read. So the half of
  someone's writing that they signed was their whole reputation.

And it moved when a moderator removed an item, because it was summed over live
items, so a number described as "what other people did" changed when nobody had
done anything.

## How

### Schema, `packages/modules/communities/drizzle/0006_karma.sql`

- `community_karma`, one row per (tenant, person), holding four numbers: post
  and comment karma over everything they wrote, and the same pair over the
  signed part. One SELECT policy, for their own row, and no write policy at
  all: the totals are theirs to read and nobody's to set.
- `karma_public`, a view of the signed half for anyone in the tenant, bound by
  the view itself to the caller's tenant.
- `karma_ledger`, how much one account has moved another's today, already
  capped. It has no policy at all, so the application cannot read it: a row
  names a voter and an author side by side, and the voter knows what they voted
  on, so one row would name an anonymous author.
- `communities_karma_vote`, a definer, called in the same transaction as the
  vote. It takes no user id: the voter comes from the session, so nobody can
  spend another account's daily budget. The public update is keyed on
  `public_author_id`, which the database generates as null for an anonymous
  item, so that update matches no row and the public number cannot move. The
  anonymity is by construction rather than by a filter somebody has to
  remember.
- `communities_karma_recompute`, which replays a tenant's votes in the order
  they were cast, applying the cap as it goes. The migration runs it for every
  tenant, so nothing is lost on the way in.

### The cap

On the net a voter may give an author in a day, not on each vote. "A day" is a
UTC date, so the boundary does not move with the server's timezone and the
running total and a rebuild always agree about which day a vote fell in. Changing a
vote and changing it back therefore costs nothing and gains nothing, and a
reader whose votes are ordinary never notices it. The tenant sets it:
`karmaVotePerDayCap`, default 10, read inside the definer so the database
decides rather than the caller.

### Votes

`votePost` and `voteComment` refuse an author's own vote with `self_vote`,
read from the view's `is_own` so it holds for an anonymous item too. Refused
rather than silently uncounted, so the tally on the item and the karma agree
about what happened.

### Reading

`src/karma.ts` replaces `karmaOf`: `publicKarma`, `publicKarmaFor` (one query
per page, not one per handle), `ownKarma` (their own row, so it cannot be asked
about anybody else however it is called), and `recomputeKarma` for the script.

### Display

Unchanged in effect: `karmaVisible` is still off by default and no tenant sets
it, so nothing renders anywhere today. Where it is on, the profile shows the
public total, and their own profile adds a line for the part only they see; a
thread shows the number beside the post author and each comment author. Nowhere
else, per the design: no feed cards and no leaderboards.

## Security

**One boundary moved, deliberately.** `post_votes` and `comment_votes` lose
FORCE. Their restrictive "your own votes only" policy binds the table owner
while FORCE is on, so no role could read every vote, and a rebuild means
reading every vote. This is the rule the module header already states: a
SECURITY DEFINER function cannot read a table with FORCE. In a split database
the application owns nothing, so RLS binds it either way and nothing widens;
what is lost is the safety net for an application pointed at the owner
credential by mistake.

Four reads leaned on that net without saying so. `myVote` was a join on the
vote table with no viewer predicate, correct only because the restrictive
policy filtered it. Those joins now name the viewer, in `posts.ts`, `feed.ts`,
`comments.ts` and `saved.ts`. RLS is still the guarantee; the query now says
what it means, and stops being right by accident. The invariant test pins the
new FORCE state with the reason.

## Tests

- Integration, three new cases and one rewritten. Karma is what other people
  did: nothing accrues for writing an item, an author's own vote on their post
  and on their comment is refused and moves neither the tally nor the karma, a
  vote and its reversal move the number and back, an anonymous post's votes
  reach the private total and never the public one, the ledger is unreadable to
  the application, and the number is per tenant. The cap: four upvotes from one
  account with the cap at two counts twice while all four votes still land, a
  second account has its own budget, and a rebuild after deleting the table
  reproduces the same totals. And `publicKarmaFor` answers for several people
  at once, returning nothing rather than zero for someone nobody voted on.
- Four existing cases changed because they voted as the author. Each now uses
  somebody else, and the votes case asserts the refusal where the self-vote
  used to be allowed.
- `pnpm turbo run typecheck lint test`: 26 tasks green.
  `pnpm --filter @campusos/module-communities test:integration`: 37 passed, 1
  skipped (the split-only case). `pnpm --filter web test:e2e`: 86 passed
  against a production build. `pnpm --filter web build` clean.
- **Not verified in a browser.** The display is behind `karmaVisible`, which is
  off for every tenant, so there is nothing to look at without changing a
  tenant's settings first. Said plainly rather than left to be assumed.

## Verification steps

Run the migration (below). With `karmaVisible` on for a tenant, upvote someone
else's post and see the number beside their handle in the thread and on their
profile; try to upvote your own and be told you cannot. Then
`pnpm communities:karma -- --tenant <slug>` and confirm the numbers are
unchanged.

## Migration notes

`packages/modules/communities/drizzle/0006_karma.sql`, applied by
`pnpm db:migrate:all`. Two new tables, one view, two functions, and one change
to existing objects: `post_votes` and `comment_votes` lose FORCE. It ends by
recomputing every tenant's karma, which is where the numbers change: totals
that included an author's own votes, or more than the cap from one account, come
out lower. Rollback: `ALTER TABLE post_votes FORCE ROW LEVEL SECURITY` and the
same for `comment_votes`, drop the two functions, the view and the two tables.
Your step on the live database.

**Existing self-votes are left alone.** The migration stops counting them
towards karma but does not delete the vote rows or correct the item scores they
inflated, because that would rewrite scores people have seen. Say the word and
it is a short follow-up.

## Breaking changes

`karmaOf` and the `Karma` interface are gone from
`@campusos/module-communities/profiles`; `publicKarma` and `ownKarma` in
`@campusos/module-communities/karma` replace them. `selectPosts` in `feed.ts`
takes the viewer as a second argument. Nothing outside this repository calls
either.

## Follow-ups

- Karma decay, still deferred (design §14).
- Removing an item no longer takes back the karma it earned, which is the
  change in behaviour this makes and matches how the design describes karma.
  If moderation should cost karma, that is a decision to take on purpose.
- A vote that was later changed replays at its original time during a rebuild,
  so a rebuilt total can differ from the running one by less than the cap. In
  the runbook, not hidden.
