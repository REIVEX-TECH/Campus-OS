-- Marketplace (services): gigs and their packages.
--
-- A gig is a service a verified member offers, priced through one to three
-- packages (Fiverr-style tiers). This migration is the catalog; ordering, the
-- order state machine and reviews arrive in 0004.
--
-- Every table carries tenant_id and is under RLS with the ordinary tenant policy
-- plus FORCE, exactly like goods. A gig and its packages are the seller's own
-- content, so creation is a normal application insert guarded by a RESTRICTIVE
-- insert-as-self policy; editing and moderation run under the tenant policy plus
-- an application permission check, and cannot cross tenants.
--
-- seller_id / removed_by are plain uuids with SQL foreign keys to users; the
-- module does not import the identity schema. Prices are integer paisa (PKR),
-- stored as bigint so no amount overflows; the app enforces a per-package cap.

CREATE TABLE "mkt_gigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"title" text NOT NULL,
	"description" text NOT NULL DEFAULT '',
	"category" text NOT NULL,
	"status" text NOT NULL DEFAULT 'active',
	"removed_at" timestamptz,
	"removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"removal_reason" text,
	"edited_at" timestamptz,
	"deleted_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mkt_gig_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"gig_id" uuid NOT NULL REFERENCES "mkt_gigs"("id") ON DELETE CASCADE,
	"tier" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL DEFAULT '',
	"price_paisa" bigint NOT NULL,
	"delivery_days" integer NOT NULL,
	"revisions" integer NOT NULL DEFAULT 0,
	"position" integer NOT NULL DEFAULT 0,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mkt_gigs_browse_idx" ON "mkt_gigs" ("tenant_id", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "mkt_gigs_category_idx" ON "mkt_gigs" ("tenant_id", "category", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "mkt_gigs_seller_idx" ON "mkt_gigs" ("tenant_id", "seller_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_gig_packages_tier_uq" ON "mkt_gig_packages" ("gig_id", "tier");
--> statement-breakpoint
CREATE INDEX "mkt_gig_packages_gig_idx" ON "mkt_gig_packages" ("gig_id", "position");
--> statement-breakpoint

-- RLS: tenant isolation on both, FORCE on both. Gigs and packages are readable
-- tenant-wide (browse); the application role is bound by these policies (it is not
-- the owner), and FORCE keeps the guarantee even if the app were ever run as the
-- owner.
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['mkt_gigs', 'mkt_gig_packages'] LOOP
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

-- A person creates a gig only as themselves; edits and moderation run under the
-- tenant policy plus an application permission check. These RESTRICTIVE policies
-- AND with the tenant policy.
CREATE POLICY "mkt_gigs_seller_is_self" ON "mkt_gigs" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("seller_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
-- A package may be inserted only onto a gig the caller sells, in this tenant.
CREATE POLICY "mkt_gig_packages_owner_is_self" ON "mkt_gig_packages" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM mkt_gigs g
			WHERE g.id = "gig_id"
			  AND g.seller_id::text = current_setting('app.user_id', true)
			  AND g.tenant_id = current_setting('app.tenant_id', true)
		)
	);
