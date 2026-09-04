# fix(communities): a standing that has run out is not a standing

## What

The two boundaries from the governance addendum that had no direct test:
a restricted member cannot write, and a suspended one cannot either. Writing
them found two real bugs, both the same shape, and both fixed here.

## Why

Standing was checked in three places that each answered the question their own
way. Identity 0014 taught one of them that a restriction with an expiry in the
past has ended, because nothing runs on a schedule to notice that an hour is
up. The other two were never told.

The result: a suspension that ran out gave the person their tenant permissions
back, and then every write still refused them, and their roles in any community
stayed gone. They could see the page and not use it, and there was nothing they
or anybody else could do except ask an administrator to lift by hand something
that had already ended.

## How

- `isVerifiedMember` in `access.ts` compared `status` literally. It now carries
  the same clause the identity resolver does: active, or an expiry that has
  passed.
- `auth_effective_community_permissions` did the same for the community half of
  its answer, in `packages/modules/communities/drizzle/0009_standing_lapse.sql`.
  Its tenant half delegates and so was already right, which is why the symptom
  was a person half restored.

One question, asked the same way in all three places. It stays duplicated
rather than centralised because two of the three are database functions the
application cannot call into, and the comments now point at each other.

## Tests

Two new integration cases, which are what found this:

- A restricted member reads a post and a community listing exactly as before,
  and is refused a post, a comment, a vote, a report, a new community and a
  join. Their own post is untouched, because a restriction is not a deletion.
  Lifting it gives everything back.
- A suspended member is refused a write, and once the expiry has passed the
  same person writes again with nothing having been run.

Both refuse with `not_verified`, which is worth saying out loud: standing and
verification meet at the same check, so the database refuses them rather than a
branch in this module.

`pnpm turbo run typecheck lint test`: 26 tasks green.
`pnpm --filter @campusos/module-communities test:integration`: 44 passed, 1
skipped. `pnpm --filter web test:e2e`: 86 passed against a production build.
`pnpm --filter web build` clean.

## Verification steps

Suspend a member for one minute from the tenant's member list. Confirm they
cannot post. Wait a minute, reload, and confirm they can, with nobody having
lifted anything.

## Migration notes

`packages/modules/communities/drizzle/0009_standing_lapse.sql`, applied by
`pnpm db:migrate:all`. It replaces one function and touches no data. Rollback:
restore the previous body from `0000_communities.sql`.

## Breaking changes

None.

## Follow-ups

- A suspension is still enforced where the pages and the writes are, not at
  sign in. That is the design: an account spans universities, and the same
  person may be in good standing at another. The addendum asked for "cannot
  sign in", and what this delivers is "has nothing in this tenant"; worth
  agreeing on explicitly rather than leaving as an implementation detail.
- Nothing sweeps expired standings, so a lapsed row keeps its `suspended`
  status until somebody writes to it. Every reader now handles that, but the
  member list still shows the old status until it is lifted.
