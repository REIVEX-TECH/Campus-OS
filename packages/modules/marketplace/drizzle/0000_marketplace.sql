-- Marketplace (goods): listings and their photos.
--
-- Every table carries tenant_id and is under RLS with the ordinary tenant policy
-- plus FORCE, exactly like Lost & Found and communities. A listing is the
-- seller's own content, so creation is a normal application insert guarded by a
-- RESTRICTIVE insert-as-self policy; editing and moderation are governed by the
-- tenant policy plus an application permission check, and cannot cross tenants.
-- Reports and their moderator definers arrive in a later migration with their own
-- tighter (NO FORCE) RLS.
--
-- seller_id / removed_by are plain uuids with SQL foreign keys to users; the
-- module does not import the identity schema. Prices are integer paisa (PKR),
-- stored as bigint so no amount overflows; the app enforces a per-listing cap.

CREATE TABLE "mkt_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"title" text NOT NULL,
	"description" text NOT NULL DEFAULT '',
	"price_paisa" bigint NOT NULL,
	"price_kind" text NOT NULL DEFAULT 'fixed',
	"category" text NOT NULL,
	"condition" text NOT NULL,
	"meetup_pref" text,
	"status" text NOT NULL DEFAULT 'active',
	"reserved_at" timestamptz,
	"sold_at" timestamptz,
	"removed_at" timestamptz,
	"removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"removal_reason" text,
	"expires_at" timestamptz,
	"expiry_notified_at" timestamptz,
	"edited_at" timestamptz,
	"deleted_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mkt_listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"listing_id" uuid NOT NULL REFERENCES "mkt_listings"("id") ON DELETE CASCADE,
	"storage_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"position" integer NOT NULL DEFAULT 0,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mkt_listings_browse_idx" ON "mkt_listings" ("tenant_id", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "mkt_listings_category_idx" ON "mkt_listings" ("tenant_id", "category", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "mkt_listings_price_idx" ON "mkt_listings" ("tenant_id", "status", "price_paisa");
--> statement-breakpoint
CREATE INDEX "mkt_listings_seller_idx" ON "mkt_listings" ("tenant_id", "seller_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mkt_listing_photos_listing_idx" ON "mkt_listing_photos" ("listing_id", "position");
--> statement-breakpoint

-- RLS: tenant isolation on both, FORCE on both. Listings and photos are readable
-- tenant-wide (browse); the application role is bound by these policies (it is not
-- the owner), and FORCE keeps the guarantee even if the app were ever run as the
-- owner.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['mkt_listings', 'mkt_listing_photos'] LOOP
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

-- A person creates a listing only as themselves; edits and moderation run under
-- the tenant policy plus an application permission check. These RESTRICTIVE
-- policies AND with the tenant policy.
CREATE POLICY "mkt_listings_seller_is_self" ON "mkt_listings" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("seller_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
-- A photo may be inserted only onto a listing the caller sells, in this tenant.
CREATE POLICY "mkt_listing_photos_owner_is_self" ON "mkt_listing_photos" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM mkt_listings l
			WHERE l.id = "listing_id"
			  AND l.seller_id::text = current_setting('app.user_id', true)
			  AND l.tenant_id = current_setting('app.tenant_id', true)
		)
	);
