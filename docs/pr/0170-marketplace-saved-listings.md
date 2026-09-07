# feat(marketplace): saved listings

Private bookmarks: a member can save a listing and browse their saved ones.

## What

- Migration `0001_marketplace_saved.sql`: `mkt_saved` (user_id, listing_id, unique
  per pair), own-row RLS on `app.user_id` + tenant + FORCE. This is per-user data
  isolation (my bookmarks), the standard own-row pattern, not a privilege decision.
- Services: `saveListing` / `unsaveListing` (idempotent), `savedListings`,
  `isListingSaved`, and `sellerActiveListings` (a seller's active listings, for the
  future profile tab).
- API `POST /api/marketplace/listings/[id]/save` (save|unsave).
- UI: a Save toggle on the listing detail (signed-in non-owners), a **Saved** page
  (`/u/[slug]/marketplace/saved`), and a Saved link in the browse header.

## Data & migration impact

New migration `0001_marketplace_saved.sql` in the marketplace set. Backwards
compatible; inert until marketplace is enabled.

## §6 review

`mkt_saved` own-row RLS keyed on `app.user_id` is DATA isolation (a member's own
bookmarks), consistent with section 8 (which forbids `app.user_id` only for
PRIVILEGE decisions). FORCE on; no definer, no grant change, no money.

## Tests

Integration: save/unsave is idempotent and private (another member's saved list and
`isListingSaved` do not see it); `sellerActiveListings` excludes a sold listing.
Module + web typecheck and lint green.

## Verification

Save a listing from its page; it appears on the Saved page; unsave removes it;
another account does not see your saves.

## Follow-ups

The seller's active-listings tab on their public profile is not in this PR (it
touches the shared profile page); it is the remaining Block 1 goods item, logged in
DECISIONS.
