# feat(marketplace): post, browse and view goods listings

The goods experience on top of the scaffold: create a listing (with photos), browse
with filters/sort/search, view a listing, and message the seller. No fee; cash on
meetup, stated in the UI. Depends on the scaffold PR.

## What

- **Module** (`@campusos/module-marketplace`): `input.ts` (listing schema + a
  phone/WhatsApp guard so contact stays in-app), `write.ts` (`createListing`
  verified-gated + rate-limited, `addListingPhoto`, `deleteListingPhotoRows`),
  `listings.ts` (`listListings` with category/condition/price/search filters and
  newest / price-asc / price-desc keyset paging; `listingById`).
- **API**: `POST /api/marketplace/listings` (create) and
  `POST /api/marketplace/listings/[id]/photos` (media pipeline: size + magic-byte
  - sharp to WebP, unguessable keys, seller-owned).
- **Pages**: browse (`/u/[slug]/marketplace`), post (`/marketplace/post`,
  verified-gated, with a prohibited-items notice), detail
  (`/marketplace/[listingId]`) with photos, price, condition, meetup, seller, a
  cash-on-meetup note, and **Message seller** (opens the messages compose with the
  listing title + link prefilled; shown only where messages is enabled and the
  viewer is not the seller).
- **Contact stays in-app**: a phone number or WhatsApp handle in the title or
  description is refused with a message pointing to in-app messaging.
- Price display/parse via `lib/money.ts` (integer paisa <-> PKR). The module-hub
  card stays "soon" for now; it goes live together with LGU enablement in Block 5
  (so the nav/sitemap tests flip once, not twice).
- Small, backward-compatible addition to the messages `ComposeSheet`: an optional
  `initialDraft`.

## Data & migration impact

No schema change (uses the scaffold's tables).

## Tests

Module + web typecheck, lint, the web unit suite, no-dash, and a local `next build`
all pass. RLS is covered by the scaffold's integration test; listing read/write is
exercised through the pages and API here.

## Verification

Enable marketplace for a tenant, then: post a listing with photos; it appears in
browse; filter by category/price/condition and sort; open it; Message seller opens
a compose prefilled with the listing. A phone number in the description is refused.

## Follow-ups

Seller actions (reserved/sold, auto-expire, saved, profile tab), moderation, and
enablement in following PRs.
