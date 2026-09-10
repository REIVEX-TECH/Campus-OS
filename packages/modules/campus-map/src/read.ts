import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Campus map reads. The map is tenant-wide public content (building and POI
 * locations), so every read is a tenant-scoped select with no actor, exactly like
 * the timetable's building/room reads. Writes (admin-only, gated on map.manage)
 * arrive in a later PR.
 */

export type MapMode = 'image' | 'geo';

export interface CampusMapView {
  id: string;
  campusId: string;
  mode: MapMode;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  centerLat: number | null;
  centerLng: number | null;
  defaultZoom: number | null;
  minZoom: number | null;
  maxZoom: number | null;
  tileUrlTemplate: string | null;
  attribution: string | null;
}

export interface BuildingPlacementView {
  id: string;
  buildingId: string;
  label: string;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
}

export interface MapPoiView {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
}

/** The map for one campus, or null if none is configured. */
export async function getMapForCampus(
  tenantId: string,
  campusId: string,
): Promise<CampusMapView | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, campus_id, mode, image_key, image_width, image_height,
               center_lat, center_lng, default_zoom, min_zoom, max_zoom,
               tile_url_template, attribution
        from campus_maps
        where tenant_id = ${tenantId} and campus_id = ${campusId}::uuid and deleted_at is null
        limit 1`)),
    ] as Array<{
      id: string;
      campus_id: string;
      mode: string;
      image_key: string | null;
      image_width: number | null;
      image_height: number | null;
      center_lat: number | null;
      center_lng: number | null;
      default_zoom: number | null;
      min_zoom: number | null;
      max_zoom: number | null;
      tile_url_template: string | null;
      attribution: string | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      campusId: r.campus_id,
      mode: r.mode === 'geo' ? 'geo' : 'image',
      imageKey: r.image_key,
      imageWidth: r.image_width,
      imageHeight: r.image_height,
      centerLat: r.center_lat,
      centerLng: r.center_lng,
      defaultZoom: r.default_zoom,
      minZoom: r.min_zoom,
      maxZoom: r.max_zoom,
      tileUrlTemplate: r.tile_url_template,
      attribution: r.attribution,
    };
  });
}

/** The buildings placed on a map, with their display label (override or name). */
export async function listPlacements(
  tenantId: string,
  mapId: string,
): Promise<BuildingPlacementView[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select p.id, p.building_id, coalesce(p.label_override, b.name) as label,
               p.x, p.y, p.lat, p.lng
        from building_placements p
        join buildings b on b.id = p.building_id
        where p.tenant_id = ${tenantId} and p.map_id = ${mapId}::uuid and p.deleted_at is null
        order by label asc`)),
    ] as Array<{
      id: string;
      building_id: string;
      label: string;
      x: number | null;
      y: number | null;
      lat: number | null;
      lng: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      buildingId: r.building_id,
      label: r.label,
      x: r.x,
      y: r.y,
      lat: r.lat,
      lng: r.lng,
    }));
  });
}

/** The standalone points of interest on a map. */
export async function listPois(tenantId: string, mapId: string): Promise<MapPoiView[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, kind, name, description, x, y, lat, lng
        from map_pois
        where tenant_id = ${tenantId} and map_id = ${mapId}::uuid and deleted_at is null
        order by name asc`)),
    ] as Array<{
      id: string;
      kind: string;
      name: string;
      description: string | null;
      x: number | null;
      y: number | null;
      lat: number | null;
      lng: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      description: r.description,
      x: r.x,
      y: r.y,
      lat: r.lat,
      lng: r.lng,
    }));
  });
}
