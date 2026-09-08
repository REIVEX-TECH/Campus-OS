-- Ride seat requests: a passenger asking for a seat on an offer, and the
-- driver's accept/decline.
--
-- Unlike a ride post (tenant-wide readable), a seat request is private to its two
-- parties: the passenger who asked, and the driver who owns the ride. RLS confines
-- it to those two, keyed on app.user_id (data isolation, not a privilege decision:
-- reading your own requests, or requests on your own ride). RLS is enabled but NOT
-- forced so a later owner-run definer (ratings, moderation) can read across the two
-- parties; the application role is a non-owner and stays confined regardless.
--
-- Accept/decline are the driver's act on their OWN ride, done in the driver's
-- context under the participant policy (the ride-ownership check is in the WHERE) --
-- no definer, the L&F claims-confirm pattern. The seat decrement is an atomic
-- conditional UPDATE on the driver's own ride row. conversation_id is reserved for
-- the messages system-conversation the accept flow will open in a later PR.

CREATE TABLE "ride_seat_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"ride_post_id" uuid NOT NULL REFERENCES "ride_posts"("id") ON DELETE CASCADE,
	"passenger_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"seats" integer NOT NULL DEFAULT 1,
	"status" text NOT NULL DEFAULT 'pending',
	"conversation_id" uuid,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"decided_at" timestamptz,
	CONSTRAINT "ride_seat_requests_status_ck"
		CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "ride_seat_requests_seats_ck" CHECK ("seats" >= 1 AND "seats" <= 8)
);
--> statement-breakpoint
CREATE INDEX "ride_seat_requests_ride_idx"
	ON "ride_seat_requests" ("ride_post_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "ride_seat_requests_passenger_idx"
	ON "ride_seat_requests" ("tenant_id", "passenger_id", "created_at");
--> statement-breakpoint
-- One live request per (ride, passenger): a passenger cannot stack pending/accepted
-- requests on the same ride. A declined/cancelled one may be re-made.
CREATE UNIQUE INDEX "ride_seat_requests_one_open_uq"
	ON "ride_seat_requests" ("ride_post_id", "passenger_id")
	WHERE "status" IN ('pending', 'accepted');
--> statement-breakpoint

-- RLS enabled, NOT forced (a later definer reads across the two parties for
-- ratings/moderation). Visible only to the passenger and the ride's author.
ALTER TABLE "ride_seat_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ride_seat_requests_participants" ON "ride_seat_requests" FOR ALL
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND (
			"passenger_id"::text = current_setting('app.user_id', true)
			OR EXISTS (
				SELECT 1 FROM ride_posts r
				WHERE r.id = "ride_seat_requests"."ride_post_id"
				  AND r.author_id::text = current_setting('app.user_id', true)
			)
		)
	)
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND (
			"passenger_id"::text = current_setting('app.user_id', true)
			OR EXISTS (
				SELECT 1 FROM ride_posts r
				WHERE r.id = "ride_seat_requests"."ride_post_id"
				  AND r.author_id::text = current_setting('app.user_id', true)
			)
		)
	);
--> statement-breakpoint
-- A request is CREATED only by the passenger, as themselves.
CREATE POLICY "ride_seat_requests_passenger_is_self" ON "ride_seat_requests"
	AS RESTRICTIVE FOR INSERT
	WITH CHECK ("passenger_id"::text = current_setting('app.user_id', true));
