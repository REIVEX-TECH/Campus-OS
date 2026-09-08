-- Ride ratings: a 1-5 rating between a driver and a passenger after a completed
-- ride, one per pairing per ride, shown on the person's public profile.
--
-- Ratings are reputation data, so their integrity matters: a rating may only be
-- written for a pairing that actually happened (an accepted passenger and the ride's
-- driver, on a COMPLETED ride). A compromised application role must not be able to
-- forge one. So the write leaves the app's hands: there is NO application INSERT
-- policy and the table's writes are revoked from the app role by name; the only
-- writer is `auth_rides_submit_rating`, a definer that re-verifies the pairing
-- against the real ride and seat-request rows (read as the owner) and keys nothing
-- on a GUC beyond the rater's own session identity (CLAUDE.md 8). Reads are
-- tenant-wide (the profile surface), so the SELECT policy is ordinary tenant isolation.

CREATE TABLE "ride_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"ride_post_id" uuid NOT NULL REFERENCES "ride_posts"("id") ON DELETE CASCADE,
	"rater_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"ratee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"direction" text NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "ride_ratings_direction_ck" CHECK ("direction" IN ('of_driver', 'of_passenger')),
	CONSTRAINT "ride_ratings_stars_ck" CHECK ("stars" BETWEEN 1 AND 5),
	CONSTRAINT "ride_ratings_no_self_ck" CHECK ("rater_id" <> "ratee_id")
);
--> statement-breakpoint
-- One rating per pairing per ride.
CREATE UNIQUE INDEX "ride_ratings_pairing_uq"
	ON "ride_ratings" ("ride_post_id", "rater_id", "ratee_id");
--> statement-breakpoint
-- The profile query reads "every rating OF this person".
CREATE INDEX "ride_ratings_ratee_idx" ON "ride_ratings" ("tenant_id", "ratee_id", "created_at");
--> statement-breakpoint

-- RLS: tenant-wide read (public-profile data), NO application write policy (the
-- definer, running as owner, is the only writer). NO FORCE so the owner writes it;
-- the app role is a non-owner and, with no write policy, is default-denied writes.
ALTER TABLE "ride_ratings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ride_ratings_read_in_tenant" ON "ride_ratings" FOR SELECT
	USING ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
-- Belt and suspenders (0016/0033 discipline): db-grants blanket-grants table DML to
-- the app, so withdraw ride_ratings writes from the app role by name in a split DB,
-- leaving the definer as the only writer even if a permissive policy were ever added.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname = 'ride_ratings' AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns ride_ratings: write lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "ride_ratings" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Write a rating, once per pairing, for a pairing that actually happened. Returns
-- 'created' | 'exists' | 'not_completed' | 'not_eligible' | 'invalid'. The rater is
-- the caller (app.user_id); the ratee and direction are validated against the ride's
-- author and its accepted seat requests, read as the owner, so a forged pairing is
-- refused. The comment is passed already contact-scrubbed by the caller.
CREATE OR REPLACE FUNCTION auth_rides_submit_rating(
	p_ride_id uuid, p_ratee uuid, p_stars integer, p_comment text, p_direction text
)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_rater uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_tenant text;
	v_author uuid;
	v_status text;
	v_eligible boolean;
BEGIN
	IF v_rater IS NULL OR p_ratee IS NULL OR v_rater = p_ratee THEN
		RETURN 'invalid';
	END IF;
	IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
		RETURN 'invalid';
	END IF;
	IF p_direction NOT IN ('of_driver', 'of_passenger') THEN
		RETURN 'invalid';
	END IF;
	SELECT tenant_id, author_id, status INTO v_tenant, v_author, v_status
	FROM ride_posts WHERE id = p_ride_id;
	IF v_tenant IS NULL THEN
		RETURN 'not_eligible';
	END IF;
	IF v_status <> 'completed' THEN
		RETURN 'not_completed';
	END IF;
	IF p_direction = 'of_driver' THEN
		-- The rater is an accepted passenger; the ratee is the driver.
		v_eligible := (p_ratee = v_author) AND EXISTS (
			SELECT 1 FROM ride_seat_requests
			WHERE ride_post_id = p_ride_id AND passenger_id = v_rater AND status = 'accepted');
	ELSE
		-- The rater is the driver; the ratee is an accepted passenger.
		v_eligible := (v_rater = v_author) AND EXISTS (
			SELECT 1 FROM ride_seat_requests
			WHERE ride_post_id = p_ride_id AND passenger_id = p_ratee AND status = 'accepted');
	END IF;
	IF NOT v_eligible THEN
		RETURN 'not_eligible';
	END IF;
	INSERT INTO ride_ratings (tenant_id, ride_post_id, rater_id, ratee_id, direction, stars, comment)
	VALUES (v_tenant, p_ride_id, v_rater, p_ratee, p_direction, p_stars, nullif(btrim(coalesce(p_comment, '')), ''))
	ON CONFLICT (ride_post_id, rater_id, ratee_id) DO NOTHING;
	IF NOT FOUND THEN
		RETURN 'exists';
	END IF;
	RETURN 'created';
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_rides_submit_rating(uuid, uuid, integer, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_rides_submit_rating(uuid, uuid, integer, text, text) TO campusos_app';
	END IF;
END
$$;
