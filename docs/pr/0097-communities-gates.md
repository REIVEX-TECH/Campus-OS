# feat(communities): participation gates that say what they want

## What

Communities C2, and addendum item 5. A community may ask for karma, or for an
account that has existed a while, before someone joins, posts or comments. The
university sets a floor underneath and a community may only tighten it. Every
gate defaults to asking for nothing, so nothing changes anywhere until a
moderator sets one.

## Why

Moderation until now was all after the fact: remove the post, ban the person,
and do it again tomorrow when they make another account. A gate is the part
that works before anything is written, and it is the ordinary answer to a
throwaway account: not "you are banned" but "this community asks for a little
history first".

And the refusals needed to start saying something. Every refusal in this module
is a bare code turned into one fixed sentence, which is fine for "you are
banned" and useless for a gate: "you cannot post here" leaves someone with no
idea whether they missed it by one karma or by fifty.

## How

### Schema, `packages/modules/communities/drizzle/0007_gates.sql`

Five columns on `communities`: `min_karma_to_post`, `min_karma_to_comment`,
`min_karma_to_join`, `min_account_age_days`, and `require_verified`. The
defaults are what the module already did, so the migration changes nobody's
experience.

Account age is age: days since the account was created. Nothing measures time
spent in the app and nothing should, because a gate that rewards lingering
punishes anyone with less time to linger.

### The floor, `src/gates.ts`

The tenant's `floorMinKarma`, `floorAccountAgeDays` and `floorRequireVerified`
sit under every community. The effective gate is the greater of the two, worked
out where the check runs rather than stored, so raising a university's floor
takes effect everywhere at once instead of needing every community rewritten. A
community that sets zero therefore does not drop below what the university asks
for.

### Where it runs

Inside the same transaction as the write, after the ban and mute checks and
before the rate limits, in `createPost`, `createComment` and `joinCommunity`.
Karma is checked before account age, so the thing somebody cannot fix by
waiting is the thing they are told about first. A community with no gates set
costs no extra query at all.

### The numbers

The write path answers with a code, `gate_karma` or `gate_account_age`. The
route then calls `describeGate`, which returns what was asked for and what the
person has, and the response carries both. That read happens only when somebody
was actually refused, so an ordinary write pays nothing for it, and no
signature in the module had to change to carry a richer error.
`refusalMessage` in the web app fills the numbers into the sentence.

## Two decisions the design did not settle

**Whoever moderates a community passes its gates.** Found by a test: an owner
who sets a fifty-karma gate cannot post the welcome message in their own
community. They can lower the gate at will, so it was never a boundary against
them; making them lower it first is only a worse way to reach the same place.
Anyone holding `communities.moderate` there passes every gate there.

**`requireVerified` can only ever tighten.** The setting is stored and shown,
but turning it off loosens nothing: every write in this module already requires
a verified membership, and `floorRequireVerified` is on by default. There is
deliberately no code path that lets an unverified person write because a
community asked for one. If opening that up is wanted, it should be its own
change, argued on its own.

## Also in here

`CommunitySummary` was built by hand in four places, so each new column meant
finding all four, and this change found them the hard way. There is now one
exported `toCommunitySummary` and the three copies are gone.

## Tests

- Integration, four new cases. The floor arithmetic: the greater of the two
  wins in both directions, a community setting zero does not drop below the
  university, and `requireVerified` goes on but never off. A karma gate blocks
  a post and a comment and then admits the same person once they have earned
  enough elsewhere in the tenant, with `describeGate` returning the numbers at
  each refusal. An account-age gate blocks joining, karma is reported before
  age, and the same person is admitted once the account is old enough. And a
  community that asks for nothing is gated anyway the moment the university
  raises its floor, without anybody editing the community.
- The moderator exemption is asserted where it was found: the owner writes in
  their own gated community while holding no karma at all.
- `pnpm turbo run typecheck lint test`: 26 tasks green.
  `pnpm --filter @campusos/module-communities test:integration`: 41 passed, 1
  skipped. `pnpm --filter web test:e2e`: 85 passed, 1 failed on the known
  `timetable.spec.ts` cold start and passed on a rerun of that file.
  `pnpm --filter web build` clean.
- **Not verified in a browser.** The gates are set from the community settings
  form and refuse at the composer; neither was exercised by hand. Said plainly
  rather than left to be assumed.

## Verification steps

Run the migration (below). As a community's moderator, open its settings, set
"Karma to post" to 5 and save. As somebody else with no karma, try to post
there and read "This community asks for 5 karma. You have 0." Set it back to
zero and post.

## Migration notes

`packages/modules/communities/drizzle/0007_gates.sql`, applied by
`pnpm db:migrate:all`. Five columns added to `communities`, all with defaults
matching current behaviour, so it is additive and needs no backfill. Rollback:
drop the five columns. Your step on the live database.

## Breaking changes

`joinCommunity` takes the tenant's communities settings as a fourth argument.
`checkGate` takes the community id. Nothing outside this repository calls
either.

## Follow-ups

- The gates are not shown to somebody before they try. A community page could
  say what it asks for, which is friendlier than finding out at the composer.
- Nothing surfaces the tenant floor in the admin UI; it is a module setting in
  the tenant config today.
- Reporting a person, the last of Phase C, is C3.
