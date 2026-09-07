# feat(marketplace): seller lifecycle (reserved/sold/relist, delete, expiry)

The seller's control of their own listing, plus auto-expiry. Depends on the goods
listings PR.

## What

- **Seller status transitions** (`setListingStatus`): active -> reserved -> sold,
  and relist (back to active) from reserved/sold/expired. Stamps `reserved_at` /
  `sold_at` on entry and clears them on relist. Only the seller's own listing moves,
  and only along an allowed edge.
- **Delete** (`deleteListing`): the seller takes their own listing down: soft-delete
  the row (out of browse and detail) and delete its photo rows; the API route then
  removes the files from object storage.
- **Extend** (`extendListing`): one tap pushes an active listing's expiry out a full
  window and clears the reminder mark.
- **Auto-expiry** (`expireActiveListings` + `scripts/marketplace-expire.ts`,
  `pnpm marketplace:expire -- --tenant <slug>`): an active listing past its window
  moves to `expired` (out of browse, still in the seller's My listings to relist).
  A plain tenant-context update (the SELECT policy is tenant-based, so no definer is
  needed, unlike a participant table).
- **Sold hides after a window**: a sold listing stays viewable for
  `soldVisibleDays` (default 7), then its detail page hides from everyone but the
  seller. Browse already excludes non-active listings.
- **UI**: seller controls on the listing detail (owner only) and a **My listings**
  page (status, expiring-soon badge, manage link), linked from browse.

## Data & migration impact

No schema change (uses the scaffold's columns: status, reserved_at, sold_at,
expires_at, expiry_notified_at, deleted_at).

## §6 review

No new RLS/definer/grant. `expireActiveListings` is a tenant-context update, safe
because `mkt_listings`' SELECT policy is tenant-based (the L&F expiry precedent);
seller transitions/delete/extend are gated on `seller_id = app.user_id` inside the
service and confined by the tenant policy, same class as the listing writes.

## Tests

Integration (CI-only): create -> reserve -> sold -> relist (seller only); delete
removes photo rows + returns keys and drops from reads; expiry flips only overdue
active listings and the seller can relist; extend moves the expiry; a phone number
in the description is refused. Module + web typecheck, lint, web unit, and a local
build pass.

## Verification

As a seller: mark a listing reserved then sold; it leaves browse; after the sold
window a non-seller gets "not here" while you still see it in My listings; relist
it; run the expiry sweep on an overdue listing and relist.

## Follow-ups

Saved listings + the profile active-listings tab, then moderation, then enablement.
