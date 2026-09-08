# feat(marketplace): order request flow and order page

Block 2d part 3: placing an order and living with it, up to the money line. A buyer
requests a package with a brief; the order gets a page with its status, the linked
chat, an activity log, and the pre-delivery controls; and, for an online order, the
awaiting-payment step shows the payment-instructions placeholder. Still behind the
disabled `marketplace-services` flag.

## What

- **Order request** (`/services/[gigId]/order?package=<id>`): verified-gate, the
  chosen package summary, a brief, and a payment-mode choice (cash on delivery, or
  online marked "coming soon"). Places the order via `POST /api/marketplace/orders`
  (the module derives the price snapshot) and lands on the order page.
- **Order page** (`/orders/[orderId]`, party-only by RLS): title, price, status,
  the counterpart, the pre-delivery controls, the brief, and the activity timeline
  from the append-only event log. For an **online order at `awaiting_payment`** it
  shows the platform payment-instructions **placeholder** (the money line). The
  linked chat is the messages module's `MessageButton` to the counterpart.
- **Order list** (`/orders`): Buying / Selling tabs (`listMyOrders`).
- **Controls** (`order-controls`): a seller accepts a request (to `awaiting_payment`
  for online, straight to `in_progress` for cash); either party cancels. Deliver /
  accept-delivery / revision arrive with the delivery UI.
- **API**: `POST /api/marketplace/orders` (place) and `POST /api/marketplace/orders/[id]`
  (transition). The transition route's allowed targets **deliberately exclude
  `paid`**: moving to paid is the money line and belongs to payment confirmation
  (Block 4), never a buyer clicking a button. A refused edge is a 409, not a 500.

## Data & migration impact

No schema change. Uses the order tables and the `mkt_order_transition` /
`mkt_place_order` definers already shipped.

## Tests

Web typecheck, lint, no-dash, and a full `pnpm --filter web build` pass (all order
routes compile). The order state machine and placement are covered by the
marketplace integration suite; the feature is flag-disabled so there is no live e2e.

## Security notes

The API is `marketplaceServicesGate` (services flag, same origin, rate limit,
signed in). Order reads are party-only by RLS; the transition definer re-derives the
actor's role from the order. The `paid` transition is not reachable from the UI or
this API.

## Follow-ups

Deliver (seller) and accept / request-revision (buyer) for orders past the money
line, with a seeded-paid test, are the last Block 2d PR. `paid`, escrow, payouts,
refunds, and disputes are Block 4 (finance), designed separately for review.
