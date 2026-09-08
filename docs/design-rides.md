# Design: Ride sharing

Members of one tenant offer and find rides to and from campus. A new `rides`
module, opt-in per tenant, disabled everywhere at ship. Same tenancy/RLS/§8
discipline as the rest of the platform. This document is the agreed design; the
decisions below are settled and the build follows them.

## Scope and non-goals

- **New module `packages/modules/rides`** with its own migrations and
  `__drizzle_migrations_rides` table, a manifest, a `rides` flag in
  `enabledModules`, disabled for every tenant. A disabled tenant contributes zero
  routes, nav, and queries (CLAUDE.md §4).
- **No money in the platform.** There is no in-app payment, fare, or fee. Cost
  splitting is a private arrangement between rider and driver; the product never
  touches it. Contact details in free text are rejected (see "No off-platform
  contact") so the module cannot become a marketplace or a fee channel.
- **No gender is ever stored.** "Women only" is a self-declared label a driver
  puts on a ride, nothing more (see "Women-only rides").
- **Not a live-location tracker.** Safety is a share link and reporting, not GPS.

## Post types

One table, `ride_posts`, holds two kinds, distinguished by `kind`:

- **`offer`** — a driver has seats. Carries `seats_total` and `seats_available`.
- **`request`** — a rider wants a seat on a route with no offer yet. `seats_total`
  is null; other members reply in a conversation (a request is a want-ad, it has
  no seat ledger).

Both carry: `origin_text`, `dest_text`, optional `origin_lat/lng` and
`dest_lat/lng` (the campus end links to the campus-map module when both are
enabled; see `docs/design-campus-map.md`), `depart_at`, free-text `notes`,
`women_only`, `status`, `created_at`, `updated_at`.

`status`: `active` | `full` | `completed` | `cancelled` | `expired`.

### Departure time and recurrence

- **A one-off ride stores `depart_at timestamptz`** — a concrete UTC instant,
  created from the tenant-local wall-clock the author picked. A single departure
  is a fixed point, so a UTC instant is correct.
- **A recurring offer** additionally stores a recurrence descriptor as wall-clock
  time plus ISO-8601 weekdays (`recurrence jsonb = { weekdays: number[], time:
"HH:MM" }`) and a `recurrence_parent_id`. Per CLAUDE.md §5, a recurring slot is
  stored as local wall-clock + weekday and materialised through the tenant
  timezone, so each spawned occurrence's `depart_at` is computed through the tenant
  tz and stays correct across DST (a fixed UTC offset would drift). Requests do not
  recur.

## Seat request flow

`ride_seat_requests`: `id`, `tenant_id`, `ride_post_id`, `passenger_user_id`,
`seats` (default 1), `status` (`pending` | `accepted` | `declined` | `cancelled`),
`conversation_id` (nullable), `created_at`, `decided_at`.

1. A verified member requests a seat on an `active` offer → a `pending` row.
2. The driver **accepts** or **declines**. Both are the driver's act on their own
   ride, done through a definer so the two-sided effects are atomic and forgery-proof:
   - **accept**: check the caller owns the ride, the request is `pending`, seats are
     available and no block exists either way; decrement `seats_available` (to zero
     flips the ride to `full`); set the request `accepted`; open a **messages**
     conversation between driver and passenger and post a **system line** ("Seat
     confirmed for <route> on <when>"); store its `conversation_id`. Notify the
     passenger (A2).
   - **decline**: set `declined`, notify the passenger. No conversation.
3. Either side may **cancel**: a passenger cancels their own request (an accepted
   cancel returns the seat and flips `full` back to `active`); a driver cancelling
   the ride declines every pending request, notifies accepted passengers, and frees
   nothing (the ride is gone).

**Cross-module seam (rides → messages), §4.** Rides must not write the messages
tables directly. The messages module exposes a small `startSystemConversation(tx,
{ tenant, a, b, systemLine })` used by the accept definer's caller; rides depends
on `@campusos/module-messages` the way the A2 emitters depend on
`@campusos/module-notifications`. If messages is **not enabled** for the tenant,
acceptance still succeeds — `conversation_id` stays null and both parties rely on
notifications. This keeps rides usable without messages and is logged as the one
accepted cross-feature dependency; a core "conversation" interface is the cleaner
long-term shape and is noted as a follow-up.

## Women-only rides

`ride_posts.women_only boolean`. This is a **label the driver sets on the ride and
a filter in browse**. The product stores **no gender for any user** and performs
**no gender check**: enforcement is social and self-declared, exactly as a physical
notice board would work. The UI states this plainly ("Women only — set by the
driver; self-declared, not verified by the platform") so no one mistakes it for a
guarantee. Recorded as a deliberate decision in `docs/overnight/DECISIONS.md`: the
alternative (storing/《verifying》gender) is a data-minimisation and safety line we
do not cross.

## No off-platform contact / no fees

`notes` is validated on save and **rejected** if it contains a phone number,
a WhatsApp/Telegram/Signal handle, or an email — the patterns that turn a ride
board into a fee-negotiation or off-platform-contact channel. The refusal message
says why. Coordination happens in the in-app conversation the accept flow opens.
This is the same "keep it on-platform" floor the messages module applies, and it is
what keeps the no-money and safety guarantees real.

## Who can post and ride

- **Posting** an offer or a request requires a **verified membership** (a
  spam-control floor), checked in the write path via `isVerifiedMember`, not
  through `auth_effective_permissions`.
- **Requesting a seat** requires a verified membership too.
- **Blocks are honored both ways** (`user_blocks`, either direction, reused from
  communities): a blocked pair cannot request/accept a seat, and a blocked author's
  rides are hidden from the blocker in browse.

## Ratings

`ride_ratings`: `id`, `tenant_id`, `ride_post_id`, `rater_user_id`,
`ratee_user_id`, `direction` (`of_driver` | `of_passenger`), `stars` (1-5),
`comment` (nullable, contact-scrubbed), `created_at`. Unique on `(ride_post_id,
rater_user_id, ratee_user_id)` — **one rating per pairing per ride**, both
directions:

- After a ride is `completed`, the driver may rate each accepted passenger and each
  accepted passenger may rate the driver.
- Aggregates (average + count, split by direction) show on the person's **public
  profile**, alongside the marketplace seller reviews already there. Individual
  comments are shown most-recent-first.
- A rating may only be written by a party to that ride (driver, or an accepted
  passenger), enforced in a definer that reads the ride and the seat requests.

## Safety

- **Share link.** A passenger with an accepted seat can generate a signed,
  expiring, read-only **trip link** (`ride_share_tokens`: token hash, seat-request
  id, expires_at) that renders a minimal public page — route, departure, driver
  handle, and any plate/notes — for a friend or family member who is not in the
  app. No PII beyond what the driver published; revocable; expires after the ride.
- **Report a ride or a person.** `ride_reports` (mirrors `lf_reports`): a member
  reports a ride post or a user with a reason; N open reports on one post hide it
  pending a moderator (the L&F `reportThreshold` shape).
- **Moderation queue.** `rides.moderate` (granted to `tenant_admin` by the module
  migration, backfilled) gates a queue that reads reports and can remove a post,
  read through an owner-run definer (`auth_rides_report_queue` /
  `auth_rides_resolve_reports`), exactly like L&F moderation.

## Browse

Server-rendered (a Server Component), URL-state filters, shareable and
back-button-correct:

- **Grouped by day** (today, tomorrow, then by date), in the tenant timezone.
- **Filters**: `kind` (offer/request), `women_only`, origin/destination free-text
  `q`, date. `seats_available > 0` for offers by default.
- Only `active`/`full` posts appear; `completed`/`expired`/`cancelled` are out of
  default browse (reachable by direct link for the parties).

## Notifications (via A2)

Generic `notify()` rows (payload + link), counted by the bell:

- seat request received (to the driver), request accepted / declined (to the
  passenger), ride cancelled (to accepted passengers), a new rating received.
- New in-conversation messages are already the messages module's notifications.

## RLS and §8

- **`ride_posts`**: SELECT for any member of the tenant while `status in
('active','full')`; the author reads their own in any status. INSERT is a
  RESTRICTIVE own-row policy (`author_user_id = app.user_id`); the verified-member
  check is in the write path. UPDATE/DELETE own-row. A moderator reads all via the
  definer. **FORCE**, since no owner-run definer needs to read across authors on
  this table (the moderation definer is owner-run and reads it as owner → its RLS
  is bypassed with NO FORCE... see next).
- **`ride_seat_requests`**: visible only to the passenger (`passenger_user_id =
app.user_id`) and the driver (`EXISTS ride_posts p WHERE p.id = ride_post_id AND
p.author_user_id = app.user_id`) — a READ visibility rule keyed on `app.user_id`,
  which §8 permits for data isolation. The **privileged writes** (accept/decline,
  the seat decrement) go through an owner-run definer that keys the decision on the
  ride's ownership read as the owner and stamps nothing forgeable — no
  privilege decision rests on a GUC. NO FORCE so the definer reads/writes as owner;
  the app role stays bound by the SELECT/own-row policies.
- **`ride_ratings`**: SELECT tenant-wide (they are public-profile data); INSERT
  only through the party-checking definer. NO FORCE (the definer reads seat requests
  as owner to confirm the pairing).
- **`ride_reports`** / **`ride_share_tokens`**: reporter/owner own-row, moderator
  via definer; reports NO FORCE for the owner-run queue, like `lf_reports`.
- Every new definer is declared in the communities `DEFINER_INTENT` map, granted
  EXECUTE to `campusos_app` by name, and self-gates (`rides.moderate`, or the
  ride-ownership / party read). The concrete SQL gets the §6 adversarial pass, not
  the design.

## Lifecycle: sweep, auto-complete, recurrence

One idempotent sweep, `pnpm rides:sweep --tenant <slug>` (runbook +
`scripts`-style cron entry, like `lost-found-expire`):

- **Auto-complete**: an `active`/`full` ride whose `depart_at + 2h < now()` with at
  least one accepted seat → `completed` (opens the rating window). With no accepted
  seat → `expired`.
- **Recurrence**: when a recurring offer completes or expires, spawn the next
  occurrence — a new `ride_posts` row with `depart_at` computed from the recurrence
  descriptor through the tenant timezone, `seats_available` reset, linked by
  `recurrence_parent_id`. Idempotent: a `(recurrence_parent_id, depart_at)` unique
  key means a re-run never double-spawns.
- Runs with no actor in the tenant context; the permissive tenant policy admits the
  status updates, exactly like the communities archive sweep and L&F expiry.

## Build order (one PR each, CI green, merged)

1. Module scaffold + `ride_posts` schema/migration + RLS + post/browse read/write
   (offers, requests, verified + block gates, notes contact-scrub) + browse UI.
2. Seat requests: schema + accept/decline definer + messages system-conversation
   seam + notifications + UI on the ride page.
3. Ratings: schema + party definer + profile surfacing.
4. Safety: reports + moderation queue (`rides.moderate`) + share link.
5. Lifecycle: sweep script + recurrence + runbook + cron; then the flag stays off
   (LGU enablement is a morning decision recorded in the report, not flipped here).
