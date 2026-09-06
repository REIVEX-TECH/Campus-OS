# feat(lost-found): module scaffold, data model, read-only browse

Lost & Found PR 2. The module package, its data model, and a read-only browse +
item page. No writing yet (posting is the next PR); the module is not enabled for
any tenant.

## What

- **`packages/modules/lost-found`** (new): manifest (`id: 'lost-found'`, own
  `__drizzle_migrations_lost_found` table, settings — categories, photo/upload
  limits, report threshold, 90-day expiry), the Drizzle schema, and the read
  service `items.ts` (`listItems` with a keyset "more" cursor, `itemById` with
  photos + the pseudonymous reporter).
- **Migration `0000_lost_found.sql`**: `lf_items` and `lf_item_photos`, each with
  `tenant_id`, RLS ENABLE + `tenant_isolation` + FORCE, and a RESTRICTIVE
  insert-as-self policy (an item's `reporter_id`, a photo's parent item) — the
  communities `posts` pattern. `building_id → buildings(id) ON DELETE SET NULL`;
  keyset indexes for browse, category and my-items.
- **Wiring**: registered in `scripts/migrate-all.ts`; the nav stub in
  `apps/web/lib/modules.ts` flipped live behind `moduleId: 'lost-found'` (shown
  only to tenants that enable the module — none yet).
- **UI**: `/u/[slug]/lost-found` (browse, lost/found kind tabs, "more"
  pagination) and `/u/[slug]/lost-found/[itemId]` (photos, details, reporter
  handle + avatar linking to their profile). Reddit-style, iOS-clean; i18n keys
  added; both pages 404 unless the tenant has enabled the module.

## Authorization

Posting and claiming will be gated on **verified membership** in the write path
(the approved design), not a role permission, so the only Lost & Found permission
is `lostfound.moderate` — added to the enforced catalogue and granted to
`tenant_admin` with the moderation PR that checks it, per the rbac "no permission
without a guard" rule. PR 2 (read-only) wires no permission.

## Data & migration impact

New tables `lf_items`, `lf_item_photos` (module migration `0000`, own bookkeeping
table). No change to existing tables. Not backwards-incompatible. Nothing runs for
a tenant until Lost & Found is in its `enabledModules` (a later PR).

## §6 (RLS, concrete SQL)

Reviewed the migration as written. `tenant_isolation` keys on `app.tenant_id`
(isolation, allowed). FORCE on both tables. Creation is RESTRICTIVE insert-as-self
(`reporter_id = app.user_id`), so an item cannot be posted as another user or into
another tenant; a photo's insert policy requires the parent item is the caller's
own (its subquery is itself under `lf_items` RLS, so a member who can _see_
another's item still cannot attach to it). Edit/remove are governed by the tenant
policy plus an application permission check (the communities posts model),
arriving with those features. No SECURITY DEFINER in this migration.

## Tests

`packages/modules/lost-found/test/lost-found.integration.test.ts` (split DB):
post-as-self + tenant-wide browse + tenant isolation; insert refused as another
user and into another tenant; photo attach allowed for the owner and refused for
another member. Typecheck, lint, journal parity verified locally; the RLS suite
runs in CI (split Postgres).

## Follow-ups

PR 3: posting an item (verified-gate, per-user rate limit) + photo upload wired to
the storage seam + my-items.
