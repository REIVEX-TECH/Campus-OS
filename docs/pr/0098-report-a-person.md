# feat(communities): report a person, not only a post

## What

Communities C3, and the last half of addendum item 6. A member can report a
person rather than one thing they wrote. Those reports belong to the university
rather than to any community, they land on the tenant administrator's queue,
and repeated reports raise a flag there. Nothing is applied to anybody
automatically.

## Why

Every report until now named a post or a comment, so the answer to somebody who
is a problem across a whole university was to remove their posts one at a time,
in whichever community noticed. Nobody could say "this person, not this post",
and nothing added up the complaints about one person into something an
administrator could see at once.

The pieces to act on it already exist: restriction and suspension shipped with
platform admin phase 7. What was missing was the thing that tells an
administrator there is a decision to make.

## How

### Schema, `packages/modules/communities/drizzle/0008_report_person.sql`

`reports.community_id` becomes nullable, and `item_type` takes `user`. A person
belongs to no community, and inventing one would file the report with
moderators who cannot act on it. A second index serves the tenant-wide read,
which the existing one leads with `community_id` and so cannot.

### Module

- `reportItem` takes `itemType: 'user'`. Their own account is refused (`self`),
  and so is an account this university does not have (`not_found`), because a
  report nobody here can act on is noise. One report per person per target, by
  the unique index that already enforced it for posts.
- `listReportedPeople` is the queue: who has open reports, how many, the
  reasons, and whether repeated reports have flagged them. Behind
  `restrict-members`, the permission for the thing the queue leads to.
- `resolveUserReports` closes every open report about somebody as `dismissed`
  or `acted`, and writes an audit line. It says the queue has been dealt with,
  never that anything was done to the person.

### Nothing hides a person

An item at the tenant's threshold hides itself, because hiding a post is cheap
and reversible. A person at the threshold is only flagged. The answers to a
person are restriction and suspension, both of which carry a reason, an
administrator, an expiry and an appeal, and both of which a human takes and
signs.

### Web

- A "Report this person" control on the profile, with the same nine reasons and
  an optional note. It reports and then says only that it was reported: the
  person reported is not owed the reporter's name, and the reporter is not owed
  the outcome.
- The queue sits on `/admin/members`, above the member list, so the flag and the
  Restrict and Suspend controls that answer it are on one page. The design
  first sketched it onto `/admin/communities`; that page is gated on
  `communities.oversee` and would only have sent an administrator somewhere
  else. The design doc now records the change and why.
- `/api/communities/people/[id]` carries both actions.

## Also in here

The nine report reasons were translated by an inline copy of the same list in
two components. There is now one `reportReasonLabels`, used by the new code.

## Tests

- Integration, one new case covering the whole shape: a self-report is refused
  and so is a report on an account this university does not have; one report
  per person, with a second from the same reporter refused; three reports from
  three people leave the target's post visible and their standing untouched;
  the queue refuses somebody without `restrict-members`, and shows the count,
  the distinct reasons and the flag; the same queue read with a higher
  threshold lists the person without flagging them, so repeated reports are the
  only thing that raises it; closing the reports empties the queue, is refused
  to a member, is `not_found` the second time, writes one audit line, and
  leaves the person exactly as they were; and a report on a post still behaves
  as it always did without appearing in the people queue.
- `pnpm turbo run typecheck lint test`: 26 tasks green.
  `pnpm --filter @campusos/module-communities test:integration`: 42 passed, 1
  skipped. `pnpm --filter web test:e2e`: 86 passed against a production build.
  `pnpm --filter web build` clean.
- **Not verified in a browser.** The report control and the queue were not
  exercised by hand. Said plainly rather than left to be assumed.

## Verification steps

Run the migration (below). As a member, open somebody's profile, report them
with a reason and a note, and confirm the control says only that it was sent.
As a tenant administrator, open the members page and read them at the top with
the count and reason; restrict them from the list below if that is the
decision, then dismiss or close the reports.

## Migration notes

`packages/modules/communities/drizzle/0008_report_person.sql`, applied by
`pnpm db:migrate:all`. One column made nullable and one index added; no data
changes and no backfill. Rollback: drop the index, and restore the NOT NULL
after deleting any `item_type = 'user'` rows, which are the only rows that can
hold a null there.

## Breaking changes

None. `reportItem` takes a wider `itemType`; every existing caller passes
`post` or `comment` and behaves exactly as before.

## Follow-ups

- The queue shows reasons but not the notes people wrote. Reading a note is
  reading what one member said about another, so it wants a thought about who
  should see it rather than being added by default.
- Nothing links a reported person to what they wrote. An administrator has the
  handle and can open the profile, which is enough to decide, but not as direct
  as it could be.
- A resolved report is closed, not deleted. If a person is repeatedly reported
  and repeatedly dismissed, nothing yet notices the pattern.
