-- Membership verification, and a place for what a person viewed recently.
--
-- VERIFIED is a fact about a membership, not a lifecycle state, so it sits
-- beside status rather than inside it: a member can be verified and suspended at
-- once, and verification carries a time and a method, both of which an admin
-- will need to see later. It is private: nothing public reads these columns.
ALTER TABLE "tenant_memberships" ADD COLUMN "verified_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "verification_method" text;
--> statement-breakpoint

-- The write side of memberships leaves the user's own hands. A person may READ
-- every membership they hold, but the only thing that may create or change one
-- is code running in a tenant context: the domain check at sign in today, and a
-- tenant admin later. No path a user controls can satisfy WITH CHECK here, which
-- is what makes "verified" unforgeable rather than merely hidden.
DROP POLICY IF EXISTS "own_or_tenant_memberships" ON "tenant_memberships";
--> statement-breakpoint
CREATE POLICY "memberships_read" ON "tenant_memberships" FOR SELECT
	USING (
		"user_id"::text = current_setting('app.user_id', true)
		OR "tenant_id" = current_setting('app.tenant_id', true)
	);
--> statement-breakpoint
CREATE POLICY "memberships_insert" ON "tenant_memberships" FOR INSERT
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "memberships_update" ON "tenant_memberships" FOR UPDATE
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "memberships_delete" ON "tenant_memberships" FOR DELETE
	USING ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- What a person viewed recently, so the timetable page can take them straight
-- back. Their own rows in both directions: theirs to write, theirs to clear.
CREATE TABLE "user_recents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"viewed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_recents_user_tenant_kind_key_uq" ON "user_recents" ("user_id", "tenant_id", "kind", "key");
--> statement-breakpoint
CREATE INDEX "user_recents_user_viewed_idx" ON "user_recents" ("user_id", "viewed_at");
--> statement-breakpoint
ALTER TABLE "user_recents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_recents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_recents" ON "user_recents"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
