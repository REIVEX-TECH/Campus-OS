-- Ride share links: a bearer-token public page for one ride, for people who are
-- not signed in. The token is a >=256-bit random secret; only its sha256 hash is
-- stored, and the shareable URL carries the raw token, never a ride or user id
-- (CLAUDE.md 8: no PII/ids in URLs). A token is created by the ride's driver or an
-- accepted passenger and can be revoked; it expires a day after departure. The
-- public page shows only what a tenant member already sees on the ride page
-- (route, time, driver handle, seats, notes) -- never emails, the rider list, or
-- any id.
--
-- No SECURITY DEFINER: the share page is served on the tenant host, so every read
-- is tenant-scoped (withTenant), exactly like the ride page itself -- the token is
-- the capability, matched by hash within the tenant. tenant_isolation + FORCE, and
-- a RESTRICTIVE insert-as-self so a token is created only as the caller. Which
-- member may publish a link (driver or accepted passenger) is enforced in the
-- write path; the link only exposes ride fields already visible to every tenant
-- member, so that check is a publishing policy, not a data boundary.

CREATE TABLE "ride_share_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"ride_post_id" uuid NOT NULL REFERENCES "ride_posts"("id") ON DELETE CASCADE,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"expires_at" timestamptz NOT NULL,
	"revoked_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The hash is unique across the table so a token maps to exactly one ride; lookups
-- still pass the tenant (the page is tenant-scoped), the hash pins the row.
CREATE UNIQUE INDEX "ride_share_tokens_hash_uq" ON "ride_share_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX "ride_share_tokens_ride_idx" ON "ride_share_tokens" ("tenant_id", "ride_post_id");
--> statement-breakpoint
ALTER TABLE "ride_share_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ride_share_tokens"
	USING (tenant_id = current_setting('app.tenant_id', true))
	WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "ride_share_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A token is created only as oneself (the write path also verifies the creator is
-- the driver or an accepted passenger). This RESTRICTIVE insert-as-self ANDs with
-- the tenant policy.
CREATE POLICY "ride_share_tokens_creator_is_self" ON "ride_share_tokens" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("created_by"::text = current_setting('app.user_id', true));
