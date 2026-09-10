# feat(rides): lifecycle sweep — auto-complete, expire, recurrence

Block B, PR 5 (the last rides backend PR). A scheduled sweep closes the ride
lifecycle: past rides complete or expire, and recurring offers spawn their next
occurrence in the tenant timezone.

## What

- **`auth_rides_sweep(tenant, hours)` (migration `0004`, SECURITY DEFINER)** — for
  rides past `hours` after departure, still `active`/`full`, not removed:
  **completed** if they carried an accepted seat (opens the rating window),
  **expired** otherwise; then, for each recurring offer that ended in this run, it
  spawns the next occurrence. Returns `(completed, expired, spawned)`.
  - It **must** be an owner-run definer: completed-vs-expired reads
    `ride_seat_requests` across users, which the app cannot see without an actor
    (participant RLS) — a no-actor sweep would find zero accepted seats and expire
    everything.
  - `ride_posts` drops FORCE (`ALTER TABLE ... NO FORCE`) so the owner can
    complete/expire across authors and insert a spawned occurrence with the original
    author's id (FORCE + the RESTRICTIVE insert-as-self would refuse the owner). The
    **application role is a non-owner and stays bound** by tenant_isolation +
    insert-as-self regardless of FORCE, so nothing the app can do changes — the
    platform_roles / role_templates / tenant_configs discipline.
- **`rides_next_occurrence(tz, weekdays[], time, after)`** — a plain STABLE function
  (no table access, not a definer) that materialises the next weekly slot through the
  tenant timezone (`timestamp AT TIME ZONE tz`), correct across DST (CLAUDE.md §5).
  The spawn computes it after `max(depart_at, now())`, so a long-missed offer jumps
  to a future slot instead of walking one past week per sweep.
- **`sweepRides(tenant, { completeAfterHours })`** (`src/lifecycle.ts`) — thin wrapper
  invoking the definer and returning the counts.
- **`scripts/rides-sweep.ts`** + root `rides:sweep` + **`docs/runbooks/rides-sweep.md`**
  (with a cron line). Idempotent: only rows this run touched spawn, and the
  `(recurrence_parent_id, depart_at)` unique index blocks a double-spawn.

## Data & migration impact

Migration `0004`: `ride_posts` NO FORCE, one plain function, one definer. Additive;
no column or data change. Rollback = drop the two functions and re-`FORCE` the table.
Nothing enabled for any tenant.

## Security review (CLAUDE.md 6, 8)

- The definer keys nothing on a GUC: it reads real rows (seat requests, the tenant
  tz) and writes status; it is a maintenance action, not a privilege decision, so it
  is app-callable (`REVOKE ALL FROM PUBLIC` then `GRANT ... TO campusos_app`),
  declared `'app'` in the communities DEFINER_INTENT audit.
- Dropping FORCE on `ride_posts` does not widen the app: the app is a non-owner and
  RLS binds it either way; FORCE only ever mattered if the app connected as the table
  owner, which the split-role invariant forbids. Same trade the other owner-written
  tables already make.
- The sweep is idempotent and scoped to one tenant per call.

## Tests

`test/rides-lifecycle.integration.test.ts` (real Postgres, split-DB only): completes
a ride with an accepted seat while expiring one without; leaves a ride still inside
the window untouched; spawns exactly one future, still-recurring child for a
recurring offer and does not re-spawn on a second sweep. 22 rides integration tests
green locally. Module typecheck + lint pass.

## Follow-ups

Block B backend is complete. Remaining: the rides **UI** (browse, forms, seat/accept,
my rides, ratings, moderation, share link) and the rides→messages system-conversation
on seat-accept (notify-only shipped). Enablement for LGU waits on the UI.
