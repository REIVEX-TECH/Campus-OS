# feat(marketplace): seller listings tab on the public profile

The last remaining Block 1 (goods) item: a person's active listings show as a tab
on their public profile, so a buyer can see what else a seller has up.

## What

- On `/u/[slug]/people/[handle]`, add a **For sale** tab, shown only when the
  tenant has the `marketplace` module enabled. It lists the person's active
  listings (newest first, up to 12) using the same `ListingCard` as browse.
- The tab is public (same visibility as the rest of the profile) and shows only
  `active` listings, never reserved, sold, expired, or removed ones. It uses
  `sellerActiveListings`, which already filters to `status = 'active'` and
  `deleted_at is null` under tenant context.
- Empty state when the person has nothing up.

## Data & migration impact

No schema change. Read-only; reuses the existing `sellerActiveListings` query.

## Tests

Web typecheck, lint, no-dash, and a local build pass. No new unit test: the query
is already covered by the marketplace integration suite; this PR only wires an
existing read into an existing page behind the module-enabled guard.

## Verification

On `/u/lgu/people/<handle>` for a member who has an active listing, a **For sale**
tab appears and shows the listing; for a tenant without marketplace enabled, no
such tab appears.

## Follow-ups

This closes Block 1 (goods). Services, money, and the platform finance admin
(Blocks 2-5) are documented as deferred in the morning report.
