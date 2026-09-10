# feat(campus-map): module scaffold, data model, and read path

Block C, step 1. A new `campus-map` module: the tables that place the tenant's
existing buildings (and standalone points of interest) onto a per-campus map, their
RLS, and the tenant-scoped read path. No UI and no write path yet; the module ships
disabled for every tenant and `map` stays a "soon" nav stub.

Design: `docs/design-campus-map.md` (added here).

## What

- `packages/modules/campus-map/` — new package (`@campusos/module-campus-map`):
  - `src/manifest.ts` — `id: 'campus-map'`, own bookkeeping table
    `__drizzle_migrations_campus_map`, `settingsSchema` (`defaultMode`, `maxPois`),
    `permissions: ['map.manage']`.
  - `drizzle/0000_campus_map.sql` — `campus_maps` (one per campus; `mode` image|geo
    with nullable image/geo columns), `building_placements` (FK → base `buildings`),
    `map_pois`. `tenant_isolation` + FORCE on all three; partial-unique indexes on the
    live rows. Grants `map.manage` to the `tenant_admin` template and backfills
    existing admin roles (mirrors rides `0003`).
  - `src/schema/campus-map.ts` — the Drizzle tables + row types.
  - `src/read.ts` — `getMapForCampus`, `listPlacements` (joins `buildings` for the
    label), `listPois`; all tenant-scoped via `withTenant`, no actor (public content).
- `scripts/migrate-all.ts` + root `package.json` — register the module (the
  migrate-all `ERR_MODULE_NOT_FOUND` trap needs the root dep).
- `packages/core/src/rbac/index.ts` — add `map.manage` to the permission catalogue
  (the DB grant is in `0000`; `tenant_admin` carries it via the existing filter).

## Data & migration impact

New tables `campus_maps`, `building_placements`, `map_pois` in the campus-map module
folder (`0000_campus_map`, own bookkeeping table), backwards-compatible. `map.manage`
added to `role_template_permissions` (idempotent insert) and backfilled. Rollback:
drop the three tables and the two permission rows. No tenant flag flipped.

## Security review (CLAUDE.md 6, 8)

- **No SECURITY DEFINER**: the map is tenant-wide public content, so every read is a
  plain tenant-scoped select. No privilege decision keys on the map.
- **RLS**: `tenant_isolation` (USING + WITH CHECK on `app.tenant_id`) + FORCE on all
  three tables; its WITH CHECK pins every insert/update to the caller's tenant, so no
  RESTRICTIVE insert-as-self is needed (there is no per-row owner). The integration
  test proves a read from another tenant returns nothing.
- **`map.manage`** is a management permission granted to the `tenant_admin` template;
  writing (a later PR) is gated on it in the write path via
  `auth_effective_permissions` (unforgeable), not on a GUC. Browsing needs no
  permission.

## Tests / verification

`packages/modules/campus-map/test/campus-map.integration.test.ts` (split-DB): a map
reads only within its own tenant; placements and POIs list only within the tenant;
`map.manage` is on the `tenant_admin` template and reaches a synced tenant's admin
role. Full-repo `turbo run typecheck lint` (34 tasks) passes; the web
migration-journal-parity suite picks up the new module. Migrations apply cleanly
locally (unsplit, so the RLS assertions run in CI, which is split).

## Follow-ups

- C2: public browse UI (Leaflet image-mode, an accessible building/POI list, deep
  links). Self-hosted Leaflet (BSD-2), no paid tiles.
- C3: the `map.manage`-gated admin editor (place/move pins + POIs, campus image via
  the `ObjectStore` seam). §6 the write path.
- Enablement (flip `enabledModules` + the nav stub) is a separate human step; not here.
