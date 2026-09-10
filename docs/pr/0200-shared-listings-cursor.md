# refactor(db): extract the keyset-cursor codec shared by browse queries

Block D, the behavior-preserving slice. The content modules each carried a
byte-identical copy of the keyset ("more") cursor codec. This lifts it into
`@campusos/db`, next to the tenant-context read helpers every browse query already
imports, and adopts it in the two enabled, e2e-covered browse functions. No behavior
change.

## What

- `packages/db/src/pagination.ts` (new) — `PAGE_SIZE`, `encodeCursor(sortVal, id)`,
  `decodeCursor(cursor) -> {sortVal, id} | null`, `toDate(value)`. Exported from the
  `@campusos/db` root.
- `packages/modules/marketplace/src/listings.ts` — drop the local copies, import from
  `@campusos/db`. Its cursor was already `(sortVal, id)`, so this is a drop-in;
  `sortPlan`/`cursorValueOf` stay (listing-specific). Re-exports `PAGE_SIZE` so the
  module's surface is unchanged.
- `packages/modules/lost-found/src/items.ts` — drop the local copies, import from
  `@campusos/db`. The old copy keyed the cursor on a `Date`; the call sites now ISO the
  date (`last.createdAt.toISOString()`) and read `cursor.sortVal` — identical base64url
  bytes, so any existing cursor still decodes. Re-exports `PAGE_SIZE`.

## Why `@campusos/db` and not `@campusos/core`

The codec uses Node `Buffer`. `@campusos/core` is a pure-domain package whose tsconfig
has no Node types, and adding them just to host a base64 helper is the wrong
dependency. `@campusos/db` already carries Node types and the `withTenant` helpers
these browse queries import, so pagination sits with the reads it serves.

## Scope: what is NOT taken (deferred, logged)

The near-verbatim `reportTarget` / `moderationQueue` / `dismiss` / `remove` copies
across marketplace / lost-found / rides, and the report-button / mod-queue React
copies, are NOT extracted here. They are not covered by existing Playwright e2e (only
communities' report/remove flow is), so they cannot be proven behavior-preserving "by
existing e2e" as the Block D brief requires, and the browse cards diverge too much for
a single component. That extraction needs its own test-first PR. Rides and gigs browse
(flag-disabled, no e2e) are also left untouched.

## Data & migration impact

No schema change. Pure code move.

## Tests / verification

Behavior-preserving, proven by existing tests (no new tests):

- `apps/web/e2e/marketplace.spec.ts` ("a member posts a goods listing that shows in
  browse ...") exercises `listListings` + the cursor in CI.
- The marketplace (35) and lost-found (13) integration suites — including the browse /
  isolation / expiry-out-of-browse cases — pass locally against real Postgres.
- `turbo run typecheck lint` passes for `@campusos/db`, `@campusos/core`,
  `@campusos/module-marketplace`, `@campusos/module-lost-found`.

## Follow-ups

The moderation-surface + browse-card extraction (test-first). Adopting the cursor codec
in rides/gigs browse when those flags and their e2e exist.
