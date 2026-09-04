# feat(identity): membership for everyone, and standing that says why

## What

Platform admin phase 7, and addendum items 3 and 6. Everyone who signs in on a
university gets a membership and the `student` role; verification stays a
separate layer that posting waits on. Standing becomes three values rather than
two, each carrying a reason, an administrator and an end, each audited, each
reversible, and none of them ever applied silently.

## Why

Two things were wrong. An address off the tenant's domain list got no
membership at all, which left that person unable to reach the page that would
have let them ask to be verified: the floor everyone needs to stand on did not
exist. And `suspended` read as an account punishment while behaving as read
only, with no reason, no actor and no end recorded anywhere, so a member could
be silenced with nothing to appeal and nobody to appeal to.

## How

### Schema, `packages/modules/identity/drizzle/0014_standing.sql`

- `tenant_memberships` gains `standing_reason`, `standing_until`,
  `standing_by`, `standing_at`, `appeal_note` and `appeal_at`, and a partial
  index on the memberships not in good standing.
- Every existing `suspended` row becomes `restricted`, which is what it already
  behaved as. Nobody is newly locked out by this migration.
- `auth_effective_permissions` gains one clause: a standing whose
  `standing_until` has passed stops counting. Without it a restriction would
  outlive its own end date in every permission check, and nothing runs on a
  schedule to notice.
- `restrict-members` joins the catalogue and the `tenant_admin` definition, and
  every tenant's copy is re-synced in the same migration that creates the thing
  it guards.

### Module

- `src/standing.ts`: `standingFor`, `standingInTransaction`, `setStanding`
  (`restricted` or `suspended`, with a reason of 3 to 300 characters and an
  optional duration), `liftStanding`, `appeal` (the person's own membership
  row, so no permission), `listStandings`. An expiry in the past is not a
  standing anywhere in this file, so nothing has to remember to check.
  `setMemberStatus` is gone from `members.ts`, which keeps the member list.
- `ensureDomainMembership` writes a membership either way: verified when the
  address is on the domain list, and otherwise a plain `student` membership
  through `joinUnverified`. An existing membership is untouched, verification
  and standing included.
- The refusals: `self`, `last_admin` (a tenant that locks out its only
  administrator needs the platform to put it right), `invalid`, `not_found`,
  `not_restricted`.

### Web

- The tenant layout answers standing once, so no page has to remember to ask. A
  restricted person sees the notice above everything they could read before; a
  suspended person sees the notice instead of the page.
- `StandingNotice` shows what was done, why, and until when, and carries the
  one appeal note, which appears back to them once sent.
- The members page shows Restrict, Suspend and Reinstate behind
  `restrict-members`, each prompting for the reason the person will be shown,
  with the standing and its reason under the member's line.
- `api/admin/members/status` now speaks the three values;
  `api/standing/appeal` is new.

## Security

The gate that already existed does the work: every write in the communities
module passes `isVerifiedMember`, which requires an active membership, and
`auth_effective_permissions` returns nothing for one that is not. Restriction
is therefore enforced in the database's own resolver rather than by a UI
check, and suspension adds the layout gate on top of it.

Nothing is shadow-applied, by design and now by test: the person is shown the
status, the reason and the expiry, and can answer. Giving everyone a membership
grants nothing new, because `student` carries reading and the right to ask;
posting, commenting, voting and starting a community all still wait on
verification.

## Tests

- Integration (three cases, two rewritten and one new): a restriction removes
  every permission, is visible to the person with its reason, is listed to an
  administrator, takes one appeal note that a lift clears, and lifting is
  idempotent; a suspension with a duration reports its end, and a duration
  moved into the past restores the permissions with nothing run and drops the
  person off the current list; a standing on oneself is `self`, without the
  permission `not_allowed`, with a two character reason `invalid`, on the last
  administrator `last_admin` even for somebody who may restrict, and on a
  stranger `not_found`. `pnpm turbo run typecheck lint test`: 26 tasks green. The identity
  integration suite is CI only (it needs the split database); locally
  `pnpm --filter @campusos/module-communities test:integration`: 34 passed, 1
  skipped. `pnpm --filter web build` clean, one new route.
- e2e (one new case): the standing route is 404 to a stranger and the appeal
  route is 401. `pnpm --filter web test:e2e`: 86 passed against a
  production build.
- Browser (local dev server): as the tenant administrator the members page
  offers Restrict and Suspend; restricting a member with a reason returns the
  standing, and as that member the community page carries "You cannot post
  here at the moment", the reason, "Until an administrator lifts it" and the
  appeal box, still shows the community, and offers no New post. The appeal
  saves and reads back as "You said:". The administrator's list then shows
  Restricted with the reason and a Reinstate control. Suspending with an hour
  replaces the page entirely: the notice, the reason and a date, and no
  community content at all. Reinstating brings back the page and New post.

## Verification steps

Run the migration (below). As a tenant administrator, restrict a member with a
reason; as that member, read the notice, leave an appeal, and confirm you can
still read but not post. Suspend them and confirm the page itself is replaced.
Reinstate and confirm everything returns.

## Migration notes

`packages/modules/identity/drizzle/0014_standing.sql`, applied by
`pnpm db:migrate:all`. Additive apart from one data change, `suspended` to
`restricted`, which preserves the behaviour those rows already had. Rollback:
set `restricted` back to `suspended`, restore the previous
`auth_effective_permissions` body from `0010_rbac.sql`, drop the six columns
and the index, and delete the `restrict-members` row from
`role_template_permissions`. Your step on the live database.

## Breaking changes

`setMemberStatus` and `MemberStatus` are gone from
`@campusos/module-identity/members`; `setStanding` and `liftStanding` in
`@campusos/module-identity/standing` replace them, and the HTTP route keeps its
path. Nothing outside this repository calls them.

## Follow-ups

- A suspended person still holds a session and is stopped at the tenant layout
  rather than at sign in. That is the design: the account is not the tenant,
  and the same person may be in good standing at another university.
- Reporting a person, the other half of addendum item 6, is communities C3.
- The tenant admin has no reading surface for the audit log yet, so the history
  of a standing is in the database rather than on a page.
