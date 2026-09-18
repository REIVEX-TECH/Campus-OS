# feat(demo): seed the demo tenant with content across every module

Run 5, PR 2. `pnpm demo:seed` — an owner-run, idempotent script that stands the `demo`
tenant up end to end: the tenant anchor + config (carrying the banner) + system roles,
seeded personas, and illustrative content across every enabled module. LGU is untouched
(the script only ever writes `demo`).

## What

- `scripts/demo/seed.ts` — `seedDemo(sql)` (exported so the reset script in PR 4 reuses
  it) + the persona list + a deterministic `uid(key)` (md5-based) so re-running inserts
  nothing new. `scripts/demo-seed.ts` — the `pnpm demo:seed` entry (owner connection via
  `withMigrationClient`).
- Seeds: 8 personas (`users.is_demo = true`) with verified `demo` memberships; a
  timetable (campus, 2 buildings, 3 rooms, a term, department, program, 4 courses, 2
  teachers, 2 sections, 6 weekly entries); 2 communities with 5 posts, 5 comments, votes
  and karma; 4 lost-and-found items; 5 marketplace listings, a gig with 2 packages, and a
  completed order with a review; 2 message threads (5 messages); and 3 rides with an
  accepted seat and a rating.
- `package.json` — the `demo:seed` script.

## How it inserts (RLS-aware)

The script runs as the owner and writes end-state rows directly (not through the module
APIs). It sets `app.tenant_id = 'demo'` for the run and `app.user_id` = the author around
each insert-as-self FORCE table (posts, comments, lost-found items, listings, gigs,
reviews), so their `WITH CHECK` passes; NO FORCE tables (users, memberships, orders,
messages, rides, votes, karma) take owner writes directly. The review is inserted after
its completed order exists and under the buyer's `app.user_id`, satisfying the earned-review
policy. Idempotency is deterministic ids + `ON CONFLICT DO NOTHING` on each table's real
unique key.

## Data & migration impact

No schema change. New tooling only; nothing runs automatically. `demo` reaches a database
only when a human runs `pnpm demo:seed` (or `pnpm tenants:sync`).

## Security review (CLAUDE.md 6, 8)

No new definer, policy, or grant. `is_demo = true` is set only here, by the owner — the
RESTRICTIVE policy from PR 1 keeps the app role from ever setting it. Personas carry a fake
`google_sub` (`demo-persona-*`) that no real Google sign-in can match, so a real user can
never resolve to a persona account.

## Tests / verification

CI does not run seed scripts, so this was verified locally against real Postgres:
`pnpm demo:seed` runs clean and is idempotent (a second run is a no-op), and a
tenant-scoped count confirms every module has its rows (posts 5, comments 5, lost-found 4,
listings 5, gig 1 + 2 packages, review 1, communities 2, timetable entries 6, rides 3 with
1 seat + 1 rating, 2 message threads). `turbo` typecheck/lint and the web/core suites are
unaffected (script-only change). The script typechecks under `tsx` and passes eslint +
prettier.

## Follow-ups (this run)

PR 3 — the read-only enforcement (H) at every mutation gate + boundary tests. PR 4 — the
reset script (E, reusing `seedDemo`) and the runbook / deploy notes (F).
