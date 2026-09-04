# feat(communities): a8, the journey under test

## What

Communities A8, the last step of Phase A: the signed in Playwright journey the
design asked for (create → post → comment → vote → report → the moderator
removes → the banned member cannot post) with the anonymity leak check inside
it, a way to mint real sessions for e2e, an error boundary for the communities
segment, and comment removal with an inline reason instead of a browser
prompt.

## Why

Everything before this was verified by the integration suite and by hand in a
browser. The design doc named one journey that has to keep working in CI, in
a real browser, signed in, and it named the one property that must never
regress: a moderator's screen carries no anonymous author. This PR pins both.

## How

- `apps/web/e2e/support/mint-sessions.ts` makes three people the way the sign
  in route does (`findOrCreateUser`, `ensureDomainMembership` against the
  tenant's domain policy, `issueSession`) with fresh subjects every run, so
  daily caps and unique names never collide; it writes the tokens to
  `e2e/.auth/sessions.json`, which is git ignored. `e2e/global-setup.ts` runs
  it through tsx before the suite; `e2e/support/sessions.ts` gives a spec a
  page signed in as a role by setting the `campusos_session` cookie. CI's e2e
  job already has a migrated, seeded database, so nothing new is provisioned.
- `apps/web/e2e/communities-journey.spec.ts`, serial: the owner starts a
  community and posts; the member joins, posts anonymously (and sees it as
  theirs with no name on it), comments, upvotes and reports; the owner reports
  the anonymous post so it reaches the queue, then the post page, the
  community page and the mod queue are each checked to contain no trace of the
  member's handle while the queue says "Anonymous author"; the owner removes
  the welcome post with a reason from the queue and bans the member from the
  members page; the member sees "Removed by moderators" and, on trying to
  post, "You are banned from this community."
- `apps/web/app/u/[slug]/c/error.tsx`: the segment's error boundary as a card
  with retry and a link back to the feed. No loading boundaries in this
  segment on purpose: streaming would turn its `notFound()` calls into
  committed 200s (the timetable loading file records the same trap), and the
  404 contract is under test.
- `comment-node.tsx`: removing a comment opens an inline reason field with
  confirm and cancel, like the post's controls.
- Status note: Phase A complete; the follow-ups carried into Phase B are
  listed there.

## Security

No schema change, no new route. The minted sessions are ordinary sessions for
ordinary members on the tenant's domain, made through the module's own
functions; the tokens live in a git ignored file for the run. The anonymity
model gains a browser level test that reads the rendered HTML a moderator
receives.

## Tests

- e2e (four new cases in one serial journey, plus the global setup).
  `pnpm --filter web test:e2e`: 78 passed against a production build; the
  journey alone passes in about six seconds once the server is warm.
- Integration: unchanged (24 passed, 1 skipped locally). `pnpm turbo run
typecheck lint`: 18 tasks green; `pnpm --filter web build` clean.
- Browser (local dev server, as a community owner): Remove on a comment opens
  the inline reason field (no browser prompt fires) with the button marked
  expanded; submitting a reason marks the comment "[removed by moderators]"
  with its reply still nested beneath, and the field closes. The signed in
  journey itself is the browser proof for the rest: it ran green four of four
  on its own and inside the full suite.

## Verification steps

`pnpm --filter web build && pnpm --filter web test:e2e` locally with the
database up; the journey needs the module enabled on the LGU tenant row (it
is, locally and in CI's seed). Then, by hand: remove a comment as a moderator
and see the inline reason field; break nothing and see no error card.

## Migration notes

No schema change.

## Breaking changes

None.

## Follow-ups

- The journey runs against the LGU fixture tenant by path; a tenant host
  variant can join the tenant-host spec later.
- The post card in a feed names its community as text; the icon and a
  community link with it come with B5's profile and directory work.
- The mod log links a post by id without its title slug.
