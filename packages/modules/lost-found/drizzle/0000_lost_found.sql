-- Lost & Found: items and their photos.
--
-- Every table carries tenant_id and is under RLS with the ordinary tenant
-- policy plus FORCE, exactly like communities. An item is the reporter's own
-- content, so creation is a normal application insert guarded by a RESTRICTIVE
-- insert-as-self policy (the posts pattern); editing and moderation are governed
-- by the tenant policy plus an application permission check, and cannot cross
-- tenants. Claims (which connect two different people) arrive later with their
-- own tighter, non-tenant-wide RLS.
--
-- reporter_id / removed_by are plain uuids with SQL foreign keys to users; the
-- module does not import the identity schema. building_id references the shared
-- buildings table and is set null if the building is removed, so a deleted
-- building never deletes a lost-item post.

CREATE TABLE "lf_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL DEFAULT '',
	"category" text NOT NULL,
	"location_text" text,
	"building_id" uuid REFERENCES "buildings"("id") ON DELETE SET NULL,
	"happened_on" date,
	"status" text NOT NULL DEFAULT 'open',
	"resolved_via_claim_id" uuid,
	"resolved_at" timestamptz,
	"expires_at" timestamptz,
	"expiry_notified_at" timestamptz,
	"removed_at" timestamptz,
	"removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"removal_reason" text,
	"edited_at" timestamptz,
	"deleted_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lf_item_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"item_id" uuid NOT NULL REFERENCES "lf_items"("id") ON DELETE CASCADE,
	"storage_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"position" integer NOT NULL DEFAULT 0,
	"removed_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "lf_items_browse_idx" ON "lf_items" ("tenant_id", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "lf_items_category_idx" ON "lf_items" ("tenant_id", "category", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "lf_items_reporter_idx" ON "lf_items" ("tenant_id", "reporter_id", "created_at");
--> statement-breakpoint
CREATE INDEX "lf_item_photos_item_idx" ON "lf_item_photos" ("item_id", "position");
--> statement-breakpoint

-- RLS: tenant isolation on both, FORCE on both. Items and photos are readable
-- tenant-wide (browse); the application role is bound by these policies (it is
-- not the owner), and FORCE keeps the guarantee even if the app were ever run as
-- the owner.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['lf_items', 'lf_item_photos'] LOOP
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

-- A person creates an item only as themselves; edits and moderation run under the
-- tenant policy plus an application permission check (the posts pattern). These
-- RESTRICTIVE policies AND with the tenant policy.
CREATE POLICY "lf_items_reporter_is_self" ON "lf_items" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("reporter_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
-- A photo may be inserted only onto an item the caller reported, in this tenant.
CREATE POLICY "lf_item_photos_owner_is_self" ON "lf_item_photos" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM lf_items i
			WHERE i.id = "item_id"
			  AND i.reporter_id::text = current_setting('app.user_id', true)
			  AND i.tenant_id = current_setting('app.tenant_id', true)
		)
	);
