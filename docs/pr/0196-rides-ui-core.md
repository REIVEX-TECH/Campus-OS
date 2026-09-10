# feat(rides): web UI — browse, post, ride page, seats, my rides

Block B, step 2 (UI part 1). The rider/driver core surfaced on the web: browse
grouped by day, the offer/request form, the ride page with the seat-request and
driver accept/decline flow, and "my rides". Ratings, reports, the moderation queue,
notifications i18n and the share link are the next UI PR.

The `rides` flag stays OFF for every tenant — the module card is gated on the flag,
so no tenant sees any of this until it is enabled.

## What

- `apps/web/lib/rides.ts` — `ridesEnabled` / `requireRides` / `ridesSettings`.
- `apps/web/lib/rides-route.ts` — `ridesGate` (same-origin, rate limit, signed in,
  body validated, tenant resolved, module enabled) + `refusalResponse` with the
  module's refusal reasons mapped to statuses. The module re-checks verification,
  ownership and blocks inside its own transaction.
- API routes (`force-dynamic`, gate → module fn → refusal): `POST /api/rides`
  (create), `POST /api/rides/[id]` (edit|cancel), `POST /api/rides/[id]/seat`
  (request), `POST /api/rides/seat/[reqId]` (accept|decline|cancel).
- Pages (Server Components, `requireRides`): `/u/[slug]/rides` (browse grouped by
  day in the tenant timezone, kind / women-only / text / date filters, keyset
  "more"), `/rides/post` (form), `/rides/[rideId]` (details + women-only note +
  rider seat control or driver request queue + owner cancel), `/rides/mine`
  (offering / riding / pending requests).
- Components (`_components/rides/`): `ride-card`, `post-ride-form` (client),
  `seat-request-button` (client), `driver-requests` (client), `cancel-ride-button`
  (client).
- `apps/web/lib/modules.ts` — `rides` becomes a live, flag-gated module card (was a
  "soon" stub); hidden until a tenant enables it.
- `apps/web/messages/en.ts` — the `rides.*` copy.
- `packages/modules/rides/package.json` — export `./seats`, `./ratings`, `./safety`
  (the UI and later PRs import them).

Recurring-offer creation UI is deferred (the backend + sweep support it; the form
needs tenant-tz handling of the recurrence time). The women-only control states
plainly that it is driver-set and unverified.

## Data & migration impact

No schema change. Web-only. No tenant flag flipped.

## Security review (CLAUDE.md 6, 8)

- Every mutation goes through `ridesGate` (same-origin + rate limit + auth + zod)
  and then the module's own transaction, which enforces verified membership,
  ownership, blocks, seat limits and the contact-info scrub. The routes add no new
  authority; naming a tenant in the body grants nothing (the module re-checks).
- No PII in URLs; the share link (a tokenised trip page) is the next PR.

## Tests / verification

Web typecheck, lint, `no-dash`, and `next build` all pass; the build compiles all
four API routes and four pages. Not yet browser-smoked: the flag is off for every
tenant and port 3000 was held by an unrelated app, so a live render check needs a
Campus OS dev server with `rides` locally enabled — done in the follow-up UI PR
alongside the seat/rating/mod flows. The backend these pages call is covered by the
rides integration suite (22 tests).

## Follow-ups

UI part 2: ratings after completion, report button + `/rides/mod` queue,
notifications i18n (`rides.*` kinds), the recurring-offer form, and the signed
share link. Then LGU enablement is a morning decision, not flipped here.
