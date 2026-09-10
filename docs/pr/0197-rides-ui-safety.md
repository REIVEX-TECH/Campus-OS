# feat(rides): moderation queue, ratings, reports, and notification lines

Block B, step 2 (UI part 2). Wires the rides safety and ratings backend (shipped in
the ratings/safety PRs) into the web app: reporting a ride, rating the other party
of a completed trip, the moderator queue, a ride-reputation block on profiles, and
the seat/cancel notification copy. Only the signed share link (UI-3) remains.

The `rides` flag stays OFF for every tenant — none of this is visible until a human
enables the module.

## What

- API routes (`force-dynamic`, `ridesGate` → module fn → `refusalResponse`):
  - `POST /api/rides/report` — `reportTarget`, passing `settings.reportThreshold`
    (rides auto-hides a ride once open reports reach the threshold).
  - `POST /api/rides/[id]/rate` — `submitRating`; eligibility is re-checked in the
    definer, so a forged body only earns a refusal.
  - `POST /api/rides/mod` — `removeRide` (rides only) / `dismissReports`; both
    moderator-gated inside the module.
- Pages / components:
  - `/u/[slug]/rides/mod` — the moderation queue, gated with
    `accessForPage(slug, 'rides.moderate')`; `RidesModQueue` (client) removes a ride
    (with a reason) or dismisses a target's reports.
  - `/u/[slug]/rides/[rideId]` — a `ReportButton` for non-authors, and `RateForm`s
    on a completed ride (the driver rates each accepted passenger; an accepted
    passenger rates the driver).
  - `/u/[slug]/rides` — a "Ride reports" link for holders of `rides.moderate`
    (`can(...)`).
  - `/u/[slug]/people/[handle]` — a `RidesReputation` block (driver / passenger
    averages + recent comments) from `ratingsForUser`, shown only when rides is
    enabled and the person has at least one rating.
  - `_components/rides/`: `report-button`, `rate-form`, `mod-queue`,
    `rides-reputation`.
- Notifications: `apps/web/lib/notifications.ts` maps the four kinds the rides
  backend already emits (`rides.seat_requested` / `seat_accepted` / `seat_declined`
  / `cancelled`) to new `notifications.generic.rides.*` lines in `en.ts` — they were
  falling back to the generic "you have a new notification".
- `apps/web/messages/en.ts` — the `rides.report.*`, `rides.rate.*`,
  `rides.reputation.*`, `rides.mod.*` copy.
- `packages/core/src/rbac/index.ts` — add `rides.moderate` to the permission
  catalogue. The DB already grants it (rides migration `0003_ride_safety.sql` seeds
  the `tenant_admin` template and backfills existing roles); the code catalogue had
  never been updated to match, so `can` / `accessForPage` could not name it.

## Data & migration impact

No schema change. Web-only, plus one type-level entry in the core permission
catalogue that aligns with the already-migrated DB template. No tenant flag flipped.

## Security review (CLAUDE.md 6, 8)

- Every mutation goes through `ridesGate` (same-origin + rate limit + auth + zod)
  and then the module transaction. Moderation writes (`removeRide`,
  `dismissReports`) re-check `rides.moderate` via `auth_effective_permissions` inside
  the module and through the report-queue/resolve definers — the route adds no
  authority, and naming a tenant in the body grants nothing.
- `submitRating` writes through the `auth_rides_submit_rating` definer, which
  re-verifies the driver/accepted-passenger pairing on a completed ride, so the
  ratee/direction in the request cannot forge an eligible pairing.
- `rides.moderate` is a moderation permission only; it is not a forgeable-GUC
  privilege gate (§8) — the DB grant + definer checks are the enforcement boundary,
  the catalogue entry is only what lets the UI name the permission. It is granted to
  the resident-administrator template exactly as `lostfound.moderate` /
  `messages.moderate` are, and to no default student/teacher role.
- No PII in URLs. Report reason/note and rating comment run the module's
  contact-info scrub.

## Tests / verification

Web typecheck + lint, `no-dash`, the full web vitest suite (128 tests) and the core
suite (44, including `rbac`) pass. Not browser-smoked: the flag is off for every
tenant, so a live render needs a dev server with `rides` locally enabled — the
backend these pages call is covered by the rides integration suite. The `rides`
integration/DEFINER-INTENT tests are unchanged (no new definer in this PR).

## Follow-ups

UI-3: the signed share link (a tokenised public trip page via an owner-run definer,
no ids/PII in the URL). Then LGU enablement is a deliberate, separate step — not
flipped here.
