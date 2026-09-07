# feat(marketplace): services catalog (gigs and packages)

Block 2 (services) part 1: the catalog. A gig is a service a verified member
offers, priced through one to three packages (Fiverr-style tiers). Ordering, the
order state machine, and reviews come next (0004); this PR is what is on offer.

## What

- **Schema** `mkt_gigs`, `mkt_gig_packages` (`packages/modules/marketplace/src/schema/services.ts`,
  migration `0003_marketplace_services.sql`). A gig carries `tenant_id`,
  `seller_id`, title/description/category, and a status (`active`/`paused`/`removed`);
  a package carries a tier (`basic`/`standard`/`premium`), price in integer paisa
  (bigint), delivery days, and included revisions. One package row per tier per gig.
- **RLS** mirrors goods exactly: tenant isolation + FORCE on both tables; a
  RESTRICTIVE insert-as-self policy on gigs (`seller_id = app.user_id`) and on
  packages (the gig must be the caller's, in this tenant). Browse is tenant-wide
  read; writes are own-content only, no definer.
- **Settings** added to the marketplace manifest: `serviceCategories` (default
  tutoring, design, writing, programming, video, music, events, other),
  `maxPackagesPerGig`, `maxPackagePricePaisa`, `maxDeliveryDays`, `maxRevisions`,
  `orderAutoCompleteDays`. Present for every tenant; a goods-only tenant never
  reads them.
- **Write** `createGig` (verified-only, per-hour rate limit, category/price/
  delivery/revision caps, distinct tiers, the same contact-info guardrail as goods
  applied to gig and package text), `setGigStatus` (pause/un-pause), `deleteGig`
  (soft-delete). **Read** `listGigs` (keyset, newest first, "from Rs X" cheapest
  package), `gigById` (with packages; rating summary stubbed until reviews land),
  `myGigs`.

## Data & migration impact

New migration `0003_marketplace_services.sql` (marketplace module folder,
`__drizzle_migrations_marketplace`). Additive; no change to existing tables.
Backwards-compatible; rollback = drop the two tables. No definers in this PR.

## Tests

`test/services.integration.test.ts` (CI Postgres+RLS): insert-as-self and package
ownership are refused, tenants are isolated on browse, `createGig` refuses contact
info / duplicate tiers / over-cap price, pause hides from browse but not the gig
page, soft-delete removes it everywhere. Package typecheck and lint pass.

## Verification

Run the marketplace migrations; `select relforcerowsecurity from pg_class where
relname in ('mkt_gigs','mkt_gig_packages')` is true for both. Integration suite:
`pnpm --filter @campusos/module-marketplace test:integration`.

## Follow-ups

Orders + the order state machine + reviews (0004) are the next PR. A gig gallery
is deferred: it would be the third copy of the photo table/write pattern (L&F,
goods, gigs), which is the point CLAUDE.md says to extract into `shared-listings`;
that refactor is tracked separately. Services stay disabled for LGU (goods only).
