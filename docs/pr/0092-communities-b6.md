# feat(communities): b6, polish

## What

The last step of Phase B: rules acceptance before a member's first post in a
community that has rules; archiving (a sweep you schedule, and Archive and
Reopen for the tenant) with archived communities read only and labelled;
flair pills on the Home and All feeds, not only inside a community; and held
items across the university on the oversight page. The status note closes
Phase B.

## Why

Each is a small thing that was named in the design and left for the end
because it needed the rest: rules have existed since A2 and now they are
read; the archive setting has existed since A1 and now it does something;
flairs from B4 now show everywhere a card does; automod's Held from A7 is
now visible to the people who oversee every community.

## How

### Schema, `packages/modules/communities/drizzle/0005_rules_acceptance.sql`

`community_memberships.rules_accepted_at`. The table has table level grants,
so the column needs none of its own; the app reads and writes it as the
person under the tenant policy.

### Module

- `rules.ts`: `rulesPending` (the community has rules, the person is a
  member, they have not accepted, and they hold neither `communities.manage`
  nor oversight), `needsRulesAcceptance`, `acceptRules` (own membership
  row; idempotent; a non member is `not_allowed`). `createPost` refuses
  `rules_not_accepted` while pending.
- `archive.ts`: `archiveIdle(tenant, months)` archives live communities
  created before the window with no live post inside it; `setArchived` for
  `communities.oversee`, into the audit log as `communities.archived` or
  `communities.reopened`. `createPost` already refused `archived`.
- `queue.ts`: `listHeld` takes a null community for oversight, tenant wide.
- `oversight.ts` returns `archivedAt` with each community.

### Web and scripts

- The compose page shows the rules with a checkbox and Continue before the
  form when acceptance is pending, and a read only notice on an archived
  community; the community page wears an Archived pill and note and offers
  no New post.
- `/c` fetches the flairs behind the page's posts in one query and the cards
  wear them.
- `/admin/communities` gains "Held across the university" and Archive or
  Reopen on each community, with an Archived pill.
- `scripts/communities-archive.ts` and `pnpm communities:archive -- --tenant
<slug> --months <n>`; `docs/runbooks/communities-archive.md` says when to
  schedule it and how to reopen.
- `api/communities/[id]/rules/accept`; `archive` on the mod route.
- Strings: `rules.gate.*`, the archived pill and note, the oversight labels.

## Security

Acceptance is the person's own membership row; the gate runs inside
`createPost`'s transaction, not only on the page. Archive and reopen need
oversight and are audited; the sweep has no actor and changes one column.
The tenant wide Held list is behind `communities.oversee` and reads through
the views like the per community one. No new policies; the RLS invariant is
unchanged.

## Tests

- Integration (three new cases): with no rules nothing is asked and a post
  goes through; after rules are set the member is asked and refused, the
  owner is not; a non member cannot accept; accepting is idempotent and the
  post then goes through. Archive is refused to an owner and done by the
  tenant, a post is refused while archived, the oversight list shows the
  time, reopening allows posts again, the sweep archives nothing newer than
  its window, an unknown community is not found. Held items in two
  communities list tenant wide for oversight and per community for a
  moderator, and tenant wide is refused to a moderator. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 34 passed, 1
  skipped (the column privilege test, split database only), with
  `0005_rules_acceptance` applied on setup. `pnpm --filter web build` clean.
  `pnpm communities:archive -- --tenant lgu --months 12` against the local
  database prints "nothing to archive in lgu".
- e2e (one new case): the accept route is 401 to a stranger. `pnpm --filter web test:e2e` against a production build:
  1 failed 83 passed on the first run, 84 passed on the second.
- Browser (local dev server): as the owner, a rule "Be kind" saved; as a
  freshly minted member the compose page shows "Before your first post here"
  with the rule, the checkbox and Continue disabled until ticked, and after
  Continue the form; the Home feed's card wears its Question flair; on
  `/admin/communities` (the owner holds oversight) "Held across the
  university" renders, Archive on a community adds the Archived pill and
  Reopen, the community page shows the pill, the read only note and no New
  post, and Reopen restores it.

## Verification steps

Run the migration (below). In a community with rules, open Submit from a
member account that has never posted there: the rules and the checkbox come
first, Continue, then the form. As a tenant admin, archive a community from
`/admin/communities`, open it (pill, note, no New post), reopen it. Run
`pnpm communities:archive -- --tenant <slug> --months 6` and read what it
prints.

## Migration notes

`packages/modules/communities/drizzle/0005_rules_acceptance.sql`, applied by
`pnpm db:migrate:all`: one nullable column. Rollback: drop it. Your step on
the live database. The archive sweep is not scheduled by this PR; the
runbook says how.

## Breaking changes

None.

## Follow-ups

- The sweep's positive path (a community that does go idle) is not under an
  integration test, because the suite cannot backdate through the app role;
  the toggle path and the refusal are.
- User flairs, search over comments and karma decay remain out, by choice.
