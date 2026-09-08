# feat(rides): seat requests — request, accept, decline, cancel

Block B, PR 2. The interactive core of rides: a passenger asks for a seat on an
offer, and the driver accepts or declines. Stacked on PR 1 (the rides module).

## What

- **`ride_seat_requests` (migration `0001`)** — a request is private to its two
  parties (the passenger and the ride's author): a participant RLS policy keyed on
  `app.user_id` (data isolation, not a privilege decision), a RESTRICTIVE
  insert-as-self, and a partial unique index so a passenger holds at most one live
  (`pending`/`accepted`) request per ride. NO FORCE, so the later ratings/moderation
  definers can read across the two parties; the app role stays confined.
- **`seats.ts`** —
  - `requestSeat`: verified member, the ride is an `active` offer that is not the
    caller's, seats remain, no block either way, no existing live request → a
    `pending` row; the driver is notified.
  - `acceptRequest`: the driver's act on their own ride (participant policy, no
    definer). Atomic seat decrement on the driver's own row (`seats_available > 0`
    guard; to zero flips the ride to `full`), the request goes `accepted`, the
    passenger is notified. A non-owner is refused; a non-pending request is refused;
    a block refuses.
  - `declineRequest`: driver-only, pending → `declined`, passenger notified.
  - `cancelSeatRequest`: the passenger's own request; an accepted cancel returns the
    seat (a `full` ride reopens to `active`).
  - `requestsForRide` (driver view) and `mySeatRequests` (passenger view).
- **`cancelRide`** now declines every live request and notifies each rider that the
  ride is off (completing PR 1's placeholder).

## Data & migration impact

New table `ride_seat_requests` (migration `0001`, rides module). Additive; no
definer, no grant change. Rollback = drop the table. Nothing enabled for any tenant.

## Security review (CLAUDE.md 6, 8)

- Seat requests are confined to the two parties by a participant policy; the
  _visibility_ is keyed on `app.user_id` (isolation, which §8 permits), and there is
  no privilege decision on a GUC. Accept/decline are the driver acting on their own
  ride under that policy (the L&F claims-confirm pattern) — no definer, no
  cross-user write path beyond the driver's own ride.
- The seat ledger cannot be oversold: the decrement is a single conditional UPDATE
  (`seats_available > 0`) on the driver's own row, so concurrent accepts serialise on
  the row and never go negative. A `CHECK` on `ride_posts` also forbids negative
  seats.
- Blocks are honored both ways (`auth_blocked_between`) at request and at accept.

## Tests

`test/rides-seats.integration.test.ts` (real Postgres, split-DB only): the
request→accept flow (seat decremented, both parties notified), the guards (own ride,
unverified, duplicate, blocked pair), full-at-zero + non-owner-accept refusal,
accepted-cancel returns the seat, decline, and ride-cancel declining live requests.
Six tests; all 12 rides integration tests green locally. Module typecheck + lint
pass. (This PR also corrects two assertion shapes in PR 1's test — `Result` is
`{ ok, value }`, and the seat cap is the tenant setting, not the input max.)

## Follow-ups

Per `docs/design-rides.md`: the messages **system-conversation** the accept flow
opens is deferred to a follow-up — for now both parties are told through
notifications (the design's graceful-degradation path when messages is disabled).
PR 3 ratings, PR 4 safety, PR 5 lifecycle. The seat-request UI rides on this layer.
