# feat(marketplace): reviews UI for completed service orders

Block A item 3, part 2. After an order completes, the buyer rates the seller 1 to 5
with an optional comment; the reviews show on the gig page and on the seller's
public profile. Backend (`writeReview`, `reviewsForGig`) already existed. Behind the
disabled `marketplace-services` flag.

## What

- **Review form** on the order page: shown to the buyer once the order is
  `completed` and they have not reviewed it; posts to
  `POST /api/marketplace/orders/[id]/review` (`writeReview` -- buyer-only, one per
  order). After reviewing, the page shows their rating.
- **Gig page**: a reviews section (`reviewsForGig`) with the rolling average and each
  review.
- **Seller profile** (`/u/[slug]/people/[handle]`): a "Service reviews" section
  (`reviewsForSeller`, new read) when services are enabled and the seller has any.
- New reads `reviewsForSeller` and `orderReview`; components `review-form`,
  `review-list`; i18n `marketplace.review.*`.

## Direction note

This is the buyer -> seller review (the existing backend), surfaced in both places a
buyer looks (the gig and the seller's profile). A mutual seller -> buyer review would
need a schema change (a reviewer role or a second table) and is not built; logged in
DECISIONS.md. (Rides, Block B, ships bidirectional ratings on its own schema.)

## Data & migration impact

No schema change.

## Tests

Marketplace + web typecheck, lint, no-dash, and a full build pass. The review write
path and the gig rating summary are covered by the marketplace integration suite;
the form/list are page assembly.

## Follow-ups

Completes Block A item 3. Next: messages delete-for-me (item 4).
