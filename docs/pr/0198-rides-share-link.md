# feat(rides): shareable trip link (public bearer-token page)

Block B, step 2 (UI part 3), the last rides UI piece. The driver or an accepted
passenger can publish a link that shows one trip to someone who is not signed in,
and revoke it. No PII or ids in the URL: the link carries a random secret; only its
hash is stored.

The `rides` flag stays OFF for every tenant.

## What

- `packages/modules/rides/drizzle/0005_ride_share_tokens.sql` — `ride_share_tokens`
  (`token_hash`, `ride_post_id`, `created_by`, `expires_at`, `revoked_at`), a unique
  index on the hash, tenant-isolation RLS + FORCE, and a RESTRICTIVE insert-as-self.
- `packages/modules/rides/src/share.ts` — `createShareLink` (verifies the caller is
  the driver or an accepted passenger, mints a 256-bit token, stores its sha256,
  expires a day after departure, returns the raw token once), `revokeShareLinks`,
  `hasActiveShareLink`, and `resolveSharedRide` (tenant-scoped read → the minimal
  trip view or null). Exported as `@campusos/module-rides/share`.
- `apps/web/app/api/rides/[id]/share/route.ts` — `POST { action: 'create' |
'revoke' }` through `ridesGate`.
- `apps/web/app/u/[slug]/r/[token]/page.tsx` — the public page (no auth). Renders the
  route, time, driver handle, seats, notes, and a "shared with you, sign in to
  request a seat" note; one generic "no longer available" for unknown / revoked /
  expired / cancelled.
- `apps/web/app/_components/rides/share-link.tsx` — create / copy / revoke on the
  ride page for the driver or an accepted passenger; the URL is composed against the
  current origin so it works on a tenant subdomain and the dev path fallback.
- `apps/web/messages/en.ts` — `rides.share.*`.

## Data & migration impact

New table `ride_share_tokens` in the rides module folder (migration
`0005_ride_share_tokens`, its own bookkeeping table), backwards-compatible.
Rollback: drop the table (no other object depends on it). No tenant flag flipped.

## Security review (CLAUDE.md 6, 8)

- **No SECURITY DEFINER.** The page is served on the tenant host, so the resolve
  runs under `withTenant` (no actor) exactly like `ridePost`; `ride_share_tokens` is
  read within its tenant, matched by hash. No owner-bypass path exists, so the table
  keeps FORCE. This keeps the §6 surface to the RLS as written.
- **The token is the capability**: 256 bits of `randomBytes`, stored only as its
  sha256; the raw token lives only in the URL, never a ride or user id (§8, no PII/
  ids in URLs). The resolve returns a row only for a live, unrevoked, unexpired,
  non-removed, non-cancelled ride.
- **RLS**: `tenant_isolation` (USING + WITH CHECK on `app.tenant_id`) + FORCE; a
  RESTRICTIVE `created_by = app.user_id` insert so a token is stamped to the caller.
  Cross-tenant reads return nothing (the query pins the tenant and the tenant policy
  backs it — a valid `aaa` token resolves to null on `bbb`).
- **Publishing** (driver or accepted passenger) is checked in the write path, both
  readable in the caller's own RLS context. It is a publishing policy, not a data
  boundary: the link exposes only ride fields already visible to every tenant member.
- **No existence oracle**: unknown / revoked / expired / cancelled all render the same
  generic message.
- **Follow-up**: rate-limit the public GET. The 256-bit token makes enumeration
  infeasible and the lookup is a single indexed query, so this is defense-in-depth.

## Tests / verification

`packages/modules/rides/test/rides-share.integration.test.ts` (split-DB): the driver
creates a link that resolves to the trip; an unknown token and a valid token on
another tenant both resolve to null; a stranger and a pending passenger are refused
while an accepted passenger succeeds; revoke and expiry and ride-cancellation each
stop resolution. Web typecheck + lint + `no-dash` + the web vitest suite (128) and
the rides typecheck pass. The migration applies cleanly locally (unsplit, so the RLS
assertions run in CI, which is split).

## Follow-ups

Rate-limit the public `/r/[token]` GET. Recurring-offer creation UI (deferred from
UI-1) still stands. Rides is then feature-complete for a human enablement decision;
this PR does not flip the flag.
