-- Campus map: place the tenant's existing buildings (and standalone points of
-- interest) onto a map a visitor can browse. Read is tenant-wide public content,
-- the same trust class as buildings/rooms; writes are admin-only, gated on the new
-- map.manage permission in the write path (the timetable admin-rooms pattern). No
-- SECURITY DEFINER: no privilege decision keys on the map. Every table is
-- tenant_id + tenant_isolation + FORCE. building_id / campus_id reference the shared
-- base tables (no cross-module import); a deleted building drops its placement.

CREATE TABLE "campus_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"campus_id" uuid NOT NULL REFERENCES "campuses"("id") ON DELETE CASCADE,
	"mode" text NOT NULL DEFAULT 'image',
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	"center_lat" double precision,
	"center_lng" double precision,
	"default_zoom" integer,
	"min_zoom" integer,
	"max_zoom" integer,
	"tile_url_template" text,
	"attribution" text,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	"deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_maps_campus_uq" ON "campus_maps" ("tenant_id", "campus_id")
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "building_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"map_id" uuid NOT NULL REFERENCES "campus_maps"("id") ON DELETE CASCADE,
	"building_id" uuid NOT NULL REFERENCES "buildings"("id") ON DELETE CASCADE,
	"x" double precision,
	"y" double precision,
	"lat" double precision,
	"lng" double precision,
	"label_override" text,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	"deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "building_placements_uq" ON "building_placements" ("tenant_id", "map_id", "building_id")
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "map_pois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"map_id" uuid NOT NULL REFERENCES "campus_maps"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"x" double precision,
	"y" double precision,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	"deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "map_pois_map_idx" ON "map_pois" ("tenant_id", "map_id");
--> statement-breakpoint

-- RLS: tenant isolation + FORCE on all three (the owner is also bound; there is no
-- definer path). Read is tenant-wide; write is gated on map.manage in the app path.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['campus_maps', 'building_placements', 'map_pois'] LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
			t
		);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
	END LOOP;
END
$$;
--> statement-breakpoint

-- Grant map.manage to the tenant_admin template and backfill the roles already
-- materialised from it, so existing and future administrators can manage the map.
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'map.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, 'map.manage'
FROM roles r
WHERE r.key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
