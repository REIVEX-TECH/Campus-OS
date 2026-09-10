import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { buildings, campuses, universities } from '@campusos/db/schema';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One map per campus. `mode` picks how it renders: 'image' overlays a campus
 * illustration (features stored as normalized x,y in [0,1]); 'geo' uses map tiles
 * (features stored as lat,lng). All coordinate columns are nullable and validated
 * per mode in the write path, so switching a campus mode is a data edit, not a
 * migration.
 */
export const campusMaps = pgTable(
  'campus_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    campusId: uuid('campus_id')
      .notNull()
      .references(() => campuses.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('image'),
    imageKey: text('image_key'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    centerLat: doublePrecision('center_lat'),
    centerLng: doublePrecision('center_lng'),
    defaultZoom: integer('default_zoom'),
    minZoom: integer('min_zoom'),
    maxZoom: integer('max_zoom'),
    tileUrlTemplate: text('tile_url_template'),
    attribution: text('attribution'),
    updatedBy: uuid('updated_by'),
    createdAt,
    updatedAt,
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    uniqueIndex('campus_maps_campus_uq')
      .on(t.tenantId, t.campusId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** A building placed on a map. References the shared buildings table. */
export const buildingPlacements = pgTable(
  'building_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    mapId: uuid('map_id')
      .notNull()
      .references(() => campusMaps.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    x: doublePrecision('x'),
    y: doublePrecision('y'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    labelOverride: text('label_override'),
    createdAt,
    updatedAt,
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    uniqueIndex('building_placements_uq')
      .on(t.tenantId, t.mapId, t.buildingId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** A standalone point of interest (gate, parking, food, ...) placed on a map. */
export const mapPois = pgTable(
  'map_pois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    mapId: uuid('map_id')
      .notNull()
      .references(() => campusMaps.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    x: doublePrecision('x'),
    y: doublePrecision('y'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt,
    updatedAt,
    deletedAt: tz('deleted_at'),
  },
  (t) => [index('map_pois_map_idx').on(t.tenantId, t.mapId)],
);

export type CampusMapRow = typeof campusMaps.$inferSelect;
export type BuildingPlacementRow = typeof buildingPlacements.$inferSelect;
export type MapPoiRow = typeof mapPois.$inferSelect;
