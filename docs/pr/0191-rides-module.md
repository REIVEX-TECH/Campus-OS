# feat(rides): the rides module — offers, requests, browse

Block B, PR 1. A new `rides` module: members of one tenant post ride **offers**
and ride **requests** and browse them. Disabled for every tenant. This PR is the
backend (schema, RLS, read/write) with its integration test; the browse/post UI,
seat requests, ratings, safety and the lifecycle sweep are the following PRs, per
`docs/design-rides.md`. The design doc lands here.

## What

- **New package `@campusos/module-rides`** — manifest (`rides` flag,
  `__drizzle_migrations_rides`, `rides.moderate` permission declared, tenant
  settings: `maxSeatsPerOffer`, `notesMaxLength`, `reportThreshold`,
  `completeAfterHours`), registered in `scripts/migrate-all.ts` after the modules
  it reads from (`auth_blocked_between`, `public_profiles`).
- **`ride_posts` (migration `0000`)** — one table, two `kind`s: an `offer` carries
  a seat ledger (`seats_total`/`seats_available`, a CHECK keeps it sane and
  non-negative), a `request` is a want-ad with no ledger. Optional route
  coordinates (the campus end links to campus-map later), `depart_at` (a concrete
  UTC instant), `notes`, `women_only`, `status`, and a recurrence descriptor +
  `recurrence_parent_id` with a unique `(parent, depart_at)` so the future sweep
  never double-spawns.
- **RLS** — tenant isolation + FORCE; a ride is tenant-wide readable (browse), and
  written only as oneself (a RESTRICTIVE insert-as-self policy, the posts pattern).
  No definer yet (none needed until seat requests / moderation).
- **Read (`posts.ts`)** — `browseRides` (upcoming `active`/`full` only, keyset
  cursor on `(depart_at, id)`, filters: kind, women-only, text, date; a blocked
  author is hidden both ways via `auth_blocked_between`, run in the viewer's actor
  context), `ridePost` (detail + author handle), `myRides`.
- **Write (`write.ts`)** — `createRidePost` (verified-member only, per-hour cap,
  seats capped by settings, future departure, offer/request shape), `editRide` and
  `cancelRide` (own active ride only, scoped in the WHERE). Contact details in a
  note are refused (`input.ts` `containsContactInfo`: email, messaging-app handle,
  phone) — the no-off-platform-contact / no-fees floor.

## Data & migration impact

New table `ride_posts` (migration `0000`, rides module) and one bookkeeping table.
Additive; no change to any existing table; no definer, no grant change. Rollback =
drop the table. Nothing enabled for any tenant.

## Security review (CLAUDE.md 6, 8)

- Writes are the posts pattern: a RESTRICTIVE `author_id = app.user_id` insert
  policy ANDed with tenant isolation, FORCE on so it binds the owner too. Edits and
  cancels are scoped to the author in the app SQL (no cross-user write path). No
  privilege decision rests on a GUC; there is no definer in this PR.
- `women_only` stores no gender — it is a self-declared label and a browse filter,
  documented as such (decision logged in `docs/overnight/DECISIONS.md`).
- Contact-info scrubbing keeps coordination on-platform (safety) and the module
  free of fee negotiation (the no-money guarantee).

## Tests

`test/rides.integration.test.ts` (real Postgres, split-DB only like the other
modules): tenant-wide browse + tenant isolation, RESTRICTIVE insert-as-self
(posting as another user is refused), the write gates (unverified, contact info,
past departure, bad seats), browse filters (kind, women-only, search), edit/cancel
scoped to the author, and the block filter hiding an author both ways. Six tests,
all green locally against `campusos_test`. Module typecheck + lint pass.

## Follow-ups

Per `docs/design-rides.md`: PR 2 seat requests (accept/decline definer + messages
system-conversation seam), PR 3 ratings, PR 4 safety (reports, mod queue, share
link), PR 5 lifecycle sweep + recurrence. The browse/post/detail web UI rides on
top of this read/write layer. LGU enablement is a morning decision recorded in the
report, not flipped here.
