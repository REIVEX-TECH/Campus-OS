# feat(marketplace): services flag and gig portfolio photos

Block 2d part 1 (backend): the `marketplace-services` enablement flag and a gig's
portfolio images, so the services UI (next PRs) has a flag to gate on and gigs have
sample photos. No tenant enables services.

## What

- **Services flag** (`apps/web/lib/marketplace.ts`): `marketplaceServicesEnabled` /
  `requireMarketplaceServices` on the separate `marketplace-services` module key
  (goods stays its own `marketplace` flag). Plus `serviceCategoryLabel(s)` and the
  `marketplace.serviceCategory.*` i18n keys.
- **`mkt_gig_photos`** (migration `0005`): a gig's portfolio images, the exact shape
  and RLS of goods' `mkt_listing_photos` — tenant isolation + FORCE, a RESTRICTIVE
  policy that a photo may be inserted only onto a gig the caller sells, tenant-wide
  read. Processed/stored through `@campusos/media` like every photo; the row holds
  the object keys.
- **Write/read** (`services-write.ts` / `services-read.ts`): `addGigPhoto`
  (verified owner, count cap), `deleteGigPhotoRows`, and `deleteGig` now removes the
  photo rows and returns their storage keys (so the caller deletes the files);
  `gigById` returns the ordered `photos`.

## Data & migration impact

New table `mkt_gig_photos` (migration `0005`, marketplace module). Additive, no
definer, no grant change. Rollback = drop the table.

## Tests

`test/services.integration.test.ts` gains a gig-photo block: the owner attaches a
photo and it shows on the gig page; a non-owner is refused by both the write helper
and the RESTRICTIVE policy (raw insert); deleting a gig removes its photo rows and
returns their keys. Marketplace + web typecheck, web no-dash pass.

## Verification

`select relforcerowsecurity from pg_class where relname = 'mkt_gig_photos'` is true;
the RESTRICTIVE `mkt_gig_photos_owner_is_self` policy exists.

## Follow-ups

This is the third photo table (L&F, goods, gigs). CLAUDE.md points at a
`packages/modules/shared-listings` extraction at this point; it touches the two
**production** modules (L&F + goods), so it is deferred to its own supervised
refactor rather than done here for a disabled feature. The gig catalog UI, order
flow, and deliver/accept UI are the next Block 2d PRs.
