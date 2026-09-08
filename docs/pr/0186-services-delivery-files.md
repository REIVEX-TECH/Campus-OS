# feat(marketplace): delivery files on a service order

Block A item 3, part 1. A seller attaches the finished work to an order; both
parties download it from the order page. Behind the disabled `marketplace-services`
flag.

## What

- **`mkt_order_files`** (migration `0006`): the delivery files on an order. Party
  read (a buyer/seller of the order), seller-only insert while the order is in
  progress or delivered (a RESTRICTIVE policy), FORCE. No definer needed: both
  recipients are parties of the order, readable through the order's own party policy.
- **Upload** `POST /api/marketplace/orders/[id]/files`: multipart, validated by
  `@campusos/media/file` (magic-byte allowlist pdf/zip/docx/xlsx/pptx, 25 MB cap),
  stored under an unguessable key, recorded only if the order is the caller's to
  deliver.
- **Download** `GET /api/marketplace/orders/[id]/files/[fileId]`: party-only (RLS
  returns nothing otherwise), streamed with `Content-Disposition: attachment` and a
  sanitised filename, `private, no-store` -- never inline.
- **UI**: the order page lists delivery files with download links; the seller sees an
  upload control while the order is in progress or delivered.
- `addOrderDeliveryFile` / `orderFiles` / `orderFileForDownload`; i18n
  `marketplace.order.delivery*`.

## Data & migration impact

New table `mkt_order_files` (migration `0006`, marketplace module). Additive, no
definer, no grant change. Rollback = drop the table.

## Security review (CLAUDE.md 6, 8)

- Files are private to the two parties (party SELECT policy over the order), and only
  the seller inserts, only on their own in-progress/delivered order, only as
  themselves (RESTRICTIVE insert). FORCE, since no owner definer reads across.
- The download route re-checks party membership through `orderFileForDownload` (RLS)
  and serves attachment-only; the allowlist already excludes HTML/SVG.

## Tests

`orders.integration.test.ts` gains an order-files block: only the seller attaches
(the buyer is refused), both parties read, a third member sees nothing, and a file
before work starts is refused. Marketplace + web typecheck, lint, no-dash, and a
full build pass.

## Follow-ups

The reviews UI is the next Block A part. Services stay disabled for LGU.
