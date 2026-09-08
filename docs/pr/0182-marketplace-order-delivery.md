# feat(marketplace): deliver / accept / revision order controls

Block 2d part 4 (the last): the delivery half of the order lifecycle. A seller
starts a paid order and marks it delivered; a buyer accepts the delivery (completing
the order) or requests a revision. Still behind the disabled `marketplace-services`
flag; still stopping short of the money line (no `paid` button).

## What

- **`order-controls`** gains the post-acceptance edges: seller **start** (a paid
  order, `paid -> in_progress`), seller **deliver** (`in_progress -> delivered`),
  buyer **accept delivery** (`delivered -> completed`) and **request a revision**
  (`delivered -> in_progress`, if the package has one left, enforced by the
  definer). Cancel stays confined to `requested` / `awaiting_payment`.
- The order page passes the new labels. No new API: these go through the same
  `POST /api/marketplace/orders/[id]` transition route, which still refuses `paid`.

## Data & migration impact

No schema change.

## Tests

`orders.integration.test.ts` gains a **seeded-paid** case: an online order is
accepted to `awaiting_payment`, then `paid` is seeded directly (as the finance flow
will set it, since paying cannot be clicked yet), and the post-payment edges the UI
drives -- start, deliver, accept -- are all exercised to `completed`. The cash happy
path and the revision cap were already covered. Web typecheck, lint, no-dash, and a
full build pass.

## Verification

With services enabled for a test tenant and a cash order: seller accepts (goes
straight to in_progress), delivers; buyer accepts to complete, or requests a
revision (bounded by the package). For an online order the flow pauses at
awaiting_payment (the money line) until Block 4.

## Follow-ups

This completes Block 2d (services UI up to the money line). Not built, by design:
delivery **files** (the `@campusos/media/file` primitive is ready; it needs an
append-only `mkt_order_deliveries` record + a download route), the reviews UI
(the `writeReview` backend is ready), and everything past the money line -- payment
confirmation, escrow, payouts, refunds, disputes, and the finance admin (Block 4,
designed for review in `docs/design-money-movements.md`).
