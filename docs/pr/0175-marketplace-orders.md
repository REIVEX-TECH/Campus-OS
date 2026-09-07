# feat(marketplace): orders, the state machine, and reviews

Block 2 (services) part 2: the workflow. Orders on a gig, an append-only event
log, the order state machine as a single SECURITY DEFINER, auto-complete, and
reviews. Money does not move here; this is the agreement and its lifecycle.

## What

- **Schema** `mkt_orders`, `mkt_order_events`, `mkt_reviews` (migration
  `0004_marketplace_orders.sql`). An order snapshots the gig + package it was
  placed against (title, price, delivery days, revisions) so a later gig edit
  never rewrites what was agreed. Statuses: `requested`, `awaiting_payment`,
  `paid`, `in_progress`, `delivered`, `completed`, `cancelled`, `disputed`.
- **The state machine** `mkt_order_transition(tenant, order, to, note)`: one
  SECURITY DEFINER that locks the order row (`FOR UPDATE`), derives the actor's
  role (buyer/seller) from the order itself, checks the edge is one that role may
  take from the current status (payment mode decides accept -> awaiting_payment vs
  straight to in_progress; a revision needs one remaining), writes the status and
  its timestamps, and appends one event -- all in the same call. Returns a text
  outcome (`ok`/`not_found`/`not_party`/`illegal`).
- **Placement** `mkt_place_order` derives the price/turnaround/revisions snapshot
  from the package itself (a raw write cannot forge the agreed amount), refuses a
  non-member or ordering your own gig, and writes the opening event.
- **Auto-complete** `mkt_order_autocomplete(tenant, days)` finishes delivered
  orders the buyer left past the window (system event, no actor; window clamped to
  > = 1 day).
- **Append-only, no app writes**: `INSERT/UPDATE/DELETE` on `mkt_orders` and
  `mkt_order_events` are revoked from `campusos_app` by name; every write is a
  definer. Orders and events are readable only by the two parties (RLS party
  policies). Reviews are tenant-wide readable (they appear on the gig page),
  written once by the buyer of a completed order (permissive insert-as-self +
  RESTRICTIVE "earned" check + unique per order), and immutable from the app side.
- **TS** `placeOrder`, `transitionOrder`, `writeReview`; `listMyOrders`,
  `orderById` (with the event log), `reviewsForGig`; `gigById` now carries the real
  rating summary.

## Data & migration impact

New migration `0004_marketplace_orders.sql` (marketplace module folder). Additive;
three new tables and three definers. Rollback = drop the tables and functions. The
definer intents (`mkt_place_order`, `mkt_order_transition`, `mkt_order_autocomplete`
= app-callable) are registered in the communities DEFINER_INTENT audit.

## Security review (CLAUDE.md 6, 8)

- The transition/placement definers key on `app.user_id` only for **data
  ownership** (is the actor this order's buyer or seller) -- the accepted use, not
  a privilege decision. Deciding a **dispute** is a platform privilege and is
  deliberately NOT here: it ships with the finance admin, gated on a grant.
- Orders/events are NO FORCE so the owner-run definers write across parties; the
  app role is a non-owner confined by the party SELECT policies and the write
  revokes (the membership-tables / 0019 discipline). Reviews are FORCE.
- The append-only guarantee is tested against the concrete SQL: a raw app UPDATE
  of status and a raw app INSERT of an event are both refused.

## Tests

`test/orders.integration.test.ts` (CI Postgres+RLS): placement snapshot integrity
and own-gig/non-member refusals; the cash and online happy paths; illegal edges
and wrong-actor; the revision cap; party isolation of the order and its events;
the raw-write refusals; buyer-only one-per-order reviews; auto-complete past the
window only. Package typecheck and lint pass; communities typecheck passes.

## Follow-ups

Delivery with files (non-image uploads) extends `@campusos/media` in the next PR;
order chat rides the messages module in the UI PR. Dispute resolution and any
money movement are later blocks. Services stay disabled for LGU (goods only).
