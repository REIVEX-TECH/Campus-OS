-- Saved listings: a member's private bookmarks.
--
-- A save belongs to the member who made it. RLS is own-row (the member sees and
-- writes only their own saves) plus tenant isolation, with FORCE. This keys on
-- app.user_id, which is the standard own-row data-isolation pattern (lf_reports,
-- communities own-row): it isolates a member's OWN data, it is not a privilege
-- decision (there is no elevated action gated on it). A save cascades away when
-- the member, the tenant, or the listing is deleted.

CREATE TABLE "mkt_saved" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"listing_id" uuid NOT NULL REFERENCES "mkt_listings"("id") ON DELETE CASCADE,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_saved_uniq" ON "mkt_saved" ("user_id", "listing_id");
--> statement-breakpoint
CREATE INDEX "mkt_saved_user_idx" ON "mkt_saved" ("tenant_id", "user_id", "created_at");
--> statement-breakpoint

ALTER TABLE "mkt_saved" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mkt_saved_own" ON "mkt_saved"
	USING (
		user_id::text = current_setting('app.user_id', true)
		AND tenant_id = current_setting('app.tenant_id', true)
	)
	WITH CHECK (
		user_id::text = current_setting('app.user_id', true)
		AND tenant_id = current_setting('app.tenant_id', true)
	);
--> statement-breakpoint
ALTER TABLE "mkt_saved" FORCE ROW LEVEL SECURITY;
