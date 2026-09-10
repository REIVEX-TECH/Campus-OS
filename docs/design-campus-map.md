# Campus map — design

Approved design for the Campus map module (Block C). Small, read-mostly,
tenant-wide public content — closest in shape to the timetable's building/room
data, not to the user-to-user modules. It places the tenant's existing
`buildings` (and standalone points of interest) onto a map a visitor can browse,
and gives admins a place to position them.

## Decisions (locked)

- **No paid map service, no API key.** §2. Rendering uses **Leaflet**
  (BSD-2-Clause, no key) in one of two modes chosen per campus:
  - **Image mode (default, LGU):** a single campus illustration/aerial served
    through the `ObjectStore` seam, drawn with `L.imageOverlay` on `CRS.Simple`.
    Features are stored as **normalized `(x, y)` in `[0,1]`** over that image, so
    the map is fully self-hosted and offline-capable — no third-party tiles.
  - **Geo mode (opt-in, later):** OpenStreetMap raster tiles via `L.tileLayer`,
    features stored as **`(lat, lng)`**. OSM has no key but a
    [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); a
    self-hosted tile fallback sits behind the same `MapTileSource` seam. Not wired
    for any tenant in this sequence; the columns and renderer branch exist so it
    is a config flip, not a migration.
- **Buildings are not duplicated.** The existing shared `buildings` table stays
  the source of truth for a building's identity; the map adds a _placement_ row
  that references `building_id` and carries only its position + optional map
  metadata. A building with no placement simply is not on the map. Standalone
  non-building features (gates, parking, cafeteria, ATM, prayer area, medical,
  library entrance) live in a separate `map_pois` table.
- **Read is tenant-wide and public** (same trust class as buildings/rooms:
  location of a lecture hall is not sensitive). RLS is **`tenant_isolation`
  only** — no privilege decision keys on the map, so no `SECURITY DEFINER` and
  no §8 use-row machinery is required here. (Contrast: rides/L&F/marketplace,
  which connect strangers and therefore carry definers + moderation.)
- **Write is admin-only, gated on a new `map.manage` permission**, checked
  server-side in the write path (the timetable admin-rooms pattern). RLS is
  `tenant_isolation` (its WITH CHECK already pins every insert/update to the
  caller's tenant, so no separate RESTRICTIVE insert is needed — the map has no
  per-row owner). Any tenant admin/moderator may manage the map; this is ordinary
  tenant administration, not the forgeable-GUC escalation surface §8 governs — so a
  permission-gated write path + tenant RLS is sufficient and correct here. The
  §6 adversarial pass still runs on the RLS as written.
- **No user-generated content, so no §8 moderation stack.** No reports, no
  claims, no threads. This is the one planned user-facing module that does _not_
  connect strangers, which is why it can ship without the reporting/blocking/queue
  release gate the others carry.
- **Flag stays OFF.** The module ships disabled for every tenant (LGU included);
  `map` stays a "soon" nav stub in committed config until a human enables it.

## Data model (`packages/modules/campus-map/`)

Own migration bookkeeping table (`__drizzle_migrations_campus_map`) — a new
module folder, never the frozen base folder (the shared-bookkeeping trap). Every
row carries `tenant_id`; RLS ENABLE + FORCE + `tenant_isolation` (its WITH CHECK
pins writes to the tenant); tenant/composite indexes.

```
campus_maps          id, tenant_id, campus_id (→ campuses, cascade),
                     mode('image'|'geo') not null default 'image',
                     -- image mode:
                     image_key?, image_width?, image_height?,   (ObjectStore key + px dims)
                     -- geo mode:
                     center_lat?, center_lng?, default_zoom?, min_zoom?, max_zoom?,
                     tile_url_template?,                          (null → default OSM)
                     attribution?,                                (shown bottom-right)
                     updated_by, ...timestamps, deleted_at
                     unique (tenant_id, campus_id) WHERE deleted_at IS NULL

building_placements  id, tenant_id, map_id (→ campus_maps, cascade),
                     building_id (→ buildings, cascade),
                     x?, y?,           (image mode: normalized [0,1])
                     lat?, lng?,       (geo mode)
                     label_override?,  (null → building.name)
                     ...timestamps, deleted_at
                     unique (tenant_id, map_id, building_id) WHERE deleted_at IS NULL

map_pois             id, tenant_id, map_id (→ campus_maps, cascade),
                     kind('gate'|'parking'|'food'|'atm'|'prayer'|'medical'|
                          'sports'|'library'|'admin'|'other'),
                     name, description?,
                     x?, y?, lat?, lng?,
                     ...timestamps, deleted_at
                     index (tenant_id, map_id)
```

`building_id` FK is `ON DELETE CASCADE` so removing a building drops its pin.
Coordinate columns are all nullable and mode-validated in the write path with
zod (image → x,y present and in `[0,1]`; geo → lat,lng present and in range), not
by a CHECK constraint, so switching a campus mode is a data edit not a migration.

## Rendering (`apps/web`)

- `MapCanvas` is a `'use client'` island (Leaflet needs the DOM). Leaflet CSS +
  JS are **self-hosted** (bundled/`public/`), not a CDN — no external asset, no
  key, works offline in image mode. Server components fetch the map + placements
  - POIs and hand them to the island as props (no client data fetch on load).
- Image mode: `L.map(el, { crs: L.CRS.Simple })`, `L.imageOverlay(url, bounds)`
  where bounds come from `image_width/height`; markers at `(y*h, x*w)`. Geo mode:
  default `L.map` + `L.tileLayer(tile_url_template ?? OSM_DEFAULT)` with the
  stored attribution; markers at `(lat, lng)`.
- Accessibility: the map is an _enhancement_, not the only path. The page also
  renders a plain, screen-reader-friendly **list of buildings and POIs**
  (grouped, linking to timetable building/room pages); markers have
  `alt`/`title`; keyboard-focusable list items pan/highlight the map. WCAG AA.
- Deep link: `/u/[slug]/map?f=<placementId|poiId>` focuses and opens that
  feature's popup, so timetable/rides pages can link "show on map".

## Manifest, permissions, admin, storage

- `packages/modules/campus-map/src/manifest.ts` — `id: 'campus-map'`,
  `migrationsTable: '__drizzle_migrations_campus_map'`, `settingsSchema`
  (`defaultMode`, `poiKinds` override, `maxPois`), `permissions: ['map.manage']`.
  Register in `scripts/migrate-all.ts` **and add the package to the root
  `package.json` deps** (the migrate-all ERR_MODULE_NOT_FOUND trap). Add
  `map.manage` to `packages/core/src/rbac/index.ts` (admin + moderator; students
  read only). Keep `map` as the nav stub in `apps/web/lib/modules.ts` until
  enablement, then flip `soon:false` + `path:'/map'` + `moduleId:'campus-map'`
  (the rides pattern) — but that flip lands only when a human enables it.
- Campus image upload reuses the L&F `ObjectStore` + `@campusos/media` pipeline
  (magic-byte sniff, EXIF strip, WebP, size cap), stored under `campus-map/<key>`
  and served at `/media/<key>` (nginx prod, Next route dev). No new storage seam.
- Admin editor is a separate `'use client'` surface under the tenant admin area,
  gated on `map.manage`: upload/replace the campus image or set geo center,
  click-to-place / drag building pins and POIs, edit labels. All writes go through
  permission-checked API routes → module services → repositories that set tenant
  context. No raw `db.select()` in routes (§4).

## PR sequence

1. **Module scaffold + data model + read path** — package, manifest, `0000`
   migration (`campus_maps` + `building_placements` + `map_pois` + RLS + indexes
   - FKs), `map.manage` permission key, register in migrate-all + root deps,
     repositories + read services (`getMapForCampus`, `listPlacements`, `listPois`).
     Unit + integration tests (tenant isolation; read returns tenant-scoped only).
     §6 the RLS as written. Nav stays a soon stub.
2. **Public browse UI** — server page `/u/[slug]/map` (renders when enabled;
   `notFound()` when not), `MapCanvas` island (image mode), the accessible
   building/POI list, deep-link focus, i18n strings. Leaflet self-hosted.
3. **Admin editor** — `map.manage`-gated routes + services (upsert map config,
   place/move/remove building pins and POIs, upload campus image via ObjectStore),
   the editor island, zod mode-validation of coordinates. §6 the write-path RLS +
   permission check. Integration tests: a non-`map.manage` actor is refused; a
   cross-tenant write is refused.
4. **Geo mode + integration links** (optional, may defer) — OSM tile renderer
   branch behind `MapTileSource`, "show on map" links from timetable building
   pages and ride pickup points, marker clustering for dense maps.

Enablement (flip `enabledModules` + the nav stub) is a **separate, human-run**
step and is explicitly not part of this sequence.
