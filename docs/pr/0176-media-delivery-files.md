# feat(media): non-image file intake for deliveries

Block 2 (services) part 3: `@campusos/media` gains a store-safe entry for
non-image files, so an order delivery can carry a PDF, a ZIP, or an Office
document. Photos already have `@campusos/media/image`; this is the parallel
`@campusos/media/file`.

## What

- `@campusos/media/file`: `validateUploadFile(bytes, { declaredType, filename,
maxBytes })` enforces a size cap (default 25 MiB), resolves the type against a
  small allowlist (pdf, zip, docx, xlsx, pptx), and does a real **magic-byte
  check** (`sniffFileFamily`) so a renamed file cannot masquerade as an allowed
  type. `newFileKey(prefix, ext)` mints a sharded storage key keeping the real
  extension (no thumbnail, unlike photos). `safeDownloadName(name, ext)` sanitises
  a filename for the `Content-Disposition` header (basename only, control chars and
  quotes stripped, forced extension).
- Unlike images, these are stored as sent (a PDF is not re-encoded), so the
  serving layer MUST send them with `Content-Disposition: attachment` and never
  inline. The allowlist already excludes HTML/SVG; attachment is belt-and-braces.
  This module is sharp-free (only `node:crypto`), so it is safe to import from a
  route.

## Data & migration impact

No schema change. Library-only.

## Tests

`packages/media/test/file.test.ts`: the magic-byte sniff, type resolution by
content-type then filename, acceptance of a real PDF and a docx (ZIP container),
rejection of a disallowed type, a PDF renamed `.docx` (`type_mismatch`), an
oversized file, and the key/filename helpers. `pnpm --filter @campusos/media test`
(20 pass), typecheck, and lint all pass.

## Verification

`pnpm --filter @campusos/media test`.

## Follow-ups

The order-delivery write path (a `mkt_order_deliveries` table, a definer that
appends a `delivery` event, and the download route that sets
`Content-Disposition: attachment`) uses this in the services UI PR. Services stay
disabled for LGU.
