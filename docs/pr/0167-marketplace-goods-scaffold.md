# feat(marketplace): goods module scaffold, model and RLS

The foundation for the Marketplace (goods): a new module package, its migration
with per-table RLS + FORCE, the manifest, and the web enablement helper. No UI and
no enablement yet (those follow); the module is off for every tenant.

## What

- `packages/modules/marketplace`: manifest (`id: 'marketplace'`, own migrations
  table `__drizzle_migrations_marketplace`, `marketplace.moderate` permission,
  settings: categories, conditions, max photos/upload/price, expiry, sold-visible
  window), schema, and RLS integration test.
- Migration `0000_marketplace.sql`: `mkt_listings` + `mkt_listing_photos`, both
  `tenant_isolation` + FORCE, with RESTRICTIVE insert-as-self (a listing only as
  its seller; a photo only onto the seller's own listing). Mirrors the Lost & Found
  0000 pattern verbatim. Price is integer paisa (PKR) stored as bigint.
- Registered in `scripts/migrate-all.ts` and the root workspace deps; `pnpm-lock`
  updated. Web helper `apps/web/lib/marketplace.ts`
  (`marketplaceEnabled`/`requireMarketplace`/`marketplaceSettings`).

## Data & migration impact

New migration `packages/modules/marketplace/drizzle/0000_marketplace.sql` in the
marketplace module set. No change to existing tables. Backwards compatible; inert
until a tenant enables `marketplace`.

## §6 review

Concrete-SQL pass done: same shape as L&F 0000 (already reviewed) — tenant
isolation on `app.tenant_id` (legitimate), FORCE on both tables, RESTRICTIVE
insert-as-self; no SECURITY DEFINER, no grant change, no money. Reports and their
moderator definers arrive in a later migration with NO FORCE, like `lf_reports`.

## Tests

Integration (CI-only, split DB): a listing is writable only as yourself and only
in your tenant, a photo only onto your own listing, and reads are tenant-isolated.
Module + web typecheck and lint green locally.

## Verification

`pnpm db:migrate:all` creates `mkt_listings` / `mkt_listing_photos`; both show
`relrowsecurity = t` and `relforcerowsecurity = t`.

## Follow-ups

Post/browse/detail, seller actions, moderation, and enablement in following PRs.
