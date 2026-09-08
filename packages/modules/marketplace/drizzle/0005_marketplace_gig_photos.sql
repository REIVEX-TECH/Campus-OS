-- Marketplace (services): a gig's portfolio photos.
--
-- Sample images a seller attaches to a gig, exactly the shape of goods'
-- mkt_listing_photos: tenant isolation + FORCE, a RESTRICTIVE policy that a photo
-- may be inserted only onto a gig the caller sells. Readable tenant-wide (the gig
-- page is public). Processed and stored through @campusos/media like every other
-- photo; the row holds the object keys.
--
-- (This is the third photo table in the codebase after L&F and goods. CLAUDE.md
-- points at a shared-listings extraction at this point; that touches the two
-- production modules and is tracked as its own supervised refactor. This migration
-- deliberately mirrors the goods photo table rather than pre-empting it.)

CREATE TABLE "mkt_gig_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"gig_id" uuid NOT NULL REFERENCES "mkt_gigs"("id") ON DELETE CASCADE,
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
CREATE INDEX "mkt_gig_photos_gig_idx" ON "mkt_gig_photos" ("gig_id", "position");
--> statement-breakpoint

ALTER TABLE "mkt_gig_photos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mkt_gig_photos" USING (
	tenant_id = current_setting('app.tenant_id', true)
) WITH CHECK (
	tenant_id = current_setting('app.tenant_id', true)
);
--> statement-breakpoint
ALTER TABLE "mkt_gig_photos" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A photo may be inserted only onto a gig the caller sells, in this tenant.
CREATE POLICY "mkt_gig_photos_owner_is_self" ON "mkt_gig_photos" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM mkt_gigs g
			WHERE g.id = "gig_id"
			  AND g.seller_id::text = current_setting('app.user_id', true)
			  AND g.tenant_id = current_setting('app.tenant_id', true)
		)
	);
