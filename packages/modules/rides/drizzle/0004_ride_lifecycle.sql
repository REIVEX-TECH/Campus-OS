-- Rides lifecycle: the sweep that auto-completes / expires past rides and spawns
-- the next occurrence of a recurring offer.
--
-- The sweep MUST be an owner-run SECURITY DEFINER, not a bare tenant-context
-- update: deciding "completed vs expired" reads `ride_seat_requests` (does the ride
-- have an accepted seat?) ACROSS users, which the application role cannot see
-- without an actor context -- the participant RLS on seat requests hides them, so a
-- no-actor sweep would find zero accepted seats and expire every ride. The definer
-- reads seat requests as the owner and writes ride status as the owner.
--
-- For that owner to write `ride_posts` at all, the table drops FORCE: the sweep
-- completes/expires rows across authors and inserts a spawned occurrence carrying
-- the ORIGINAL author's id, both of which FORCE + the RESTRICTIVE insert-as-self
-- policy would refuse for the owner. The application role is a NON-owner and stays
-- bound by tenant_isolation + insert-as-self regardless of FORCE, so nothing the
-- app can do changes -- this is the platform_roles / role_templates / tenant_configs
-- discipline (owner writes through a definer; app confined by policy).

ALTER TABLE "ride_posts" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The next concrete instant for a weekly recurrence, materialised through the tenant
-- timezone (CLAUDE.md 5: wall-clock + ISO weekday interpreted in the tenant tz, so
-- it stays correct across DST where a fixed UTC offset would drift). Pure over its
-- inputs; reads no table, so it is a plain function, not a definer.
CREATE OR REPLACE FUNCTION rides_next_occurrence(
	p_tz text, p_weekdays integer[], p_time text, p_after timestamptz
)
	RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
	v_date date := (p_after AT TIME ZONE p_tz)::date;
	v_cand timestamptz;
	i integer;
BEGIN
	IF p_weekdays IS NULL OR array_length(p_weekdays, 1) IS NULL OR p_time IS NULL THEN
		RETURN NULL;
	END IF;
	-- Walk forward from the day after the reference date; two weeks covers any set.
	FOR i IN 1..14 LOOP
		v_date := v_date + 1;
		IF extract(isodow FROM v_date)::int = ANY (p_weekdays) THEN
			v_cand := (v_date::text || ' ' || p_time)::timestamp AT TIME ZONE p_tz;
			IF v_cand > p_after THEN
				RETURN v_cand;
			END IF;
		END IF;
	END LOOP;
	RETURN NULL;
END; $$;
--> statement-breakpoint

-- Sweep one tenant: complete rides past `p_hours` after departure that carried an
-- accepted seat, expire the rest, and spawn the next occurrence of each recurring
-- offer that just ended. Idempotent: only rows still active/full and past the window
-- are touched, and the spawn is guarded by the (recurrence_parent_id, depart_at)
-- unique index, so a re-run never double-spawns. Returns the three counts.
CREATE OR REPLACE FUNCTION auth_rides_sweep(p_tenant_id text, p_hours integer)
	RETURNS TABLE (completed integer, expired integer, spawned integer)
	LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_tz text;
	v_hours integer := greatest(coalesce(p_hours, 2), 1);
	v_completed integer := 0;
	v_expired integer := 0;
	v_spawned integer := 0;
	r ride_posts%ROWTYPE;
	v_next timestamptz;
	v_root uuid;
	v_weekdays integer[];
BEGIN
	SELECT timezone INTO v_tz FROM universities WHERE slug = p_tenant_id;
	IF v_tz IS NULL THEN
		RETURN QUERY SELECT 0, 0, 0;
		RETURN;
	END IF;

	-- Complete: past the window, with at least one accepted seat.
	UPDATE ride_posts SET status = 'completed', completed_at = now(), updated_at = now()
	WHERE tenant_id = p_tenant_id AND status IN ('active', 'full') AND removed_at IS NULL
	  AND depart_at + make_interval(hours => v_hours) <= now()
	  AND EXISTS (
		SELECT 1 FROM ride_seat_requests rs
		WHERE rs.ride_post_id = ride_posts.id AND rs.status = 'accepted');
	GET DIAGNOSTICS v_completed = ROW_COUNT;

	-- Expire: whatever is still active/full and past the window (no accepted seat).
	UPDATE ride_posts SET status = 'expired', updated_at = now()
	WHERE tenant_id = p_tenant_id AND status IN ('active', 'full') AND removed_at IS NULL
	  AND depart_at + make_interval(hours => v_hours) <= now();
	GET DIAGNOSTICS v_expired = ROW_COUNT;

	-- Spawn the next occurrence of every recurring offer that ended in THIS sweep.
	-- `updated_at = now()` (now() is fixed per transaction) selects exactly the rows
	-- this run just touched, so an occurrence ended in a prior sweep is not re-spawned.
	FOR r IN
		SELECT * FROM ride_posts
		WHERE tenant_id = p_tenant_id AND kind = 'offer' AND recurrence IS NOT NULL
		  AND status IN ('completed', 'expired') AND updated_at = now()
	LOOP
		v_weekdays := ARRAY(
			SELECT jsonb_array_elements_text(r.recurrence -> 'weekdays')::int);
		-- Next slot after the later of this occurrence and now, so a long-missed offer
		-- jumps to a future slot instead of walking one past week per sweep.
		v_next := rides_next_occurrence(
			v_tz, v_weekdays, r.recurrence ->> 'time', greatest(r.depart_at, now()));
		IF v_next IS NULL THEN
			CONTINUE;
		END IF;
		v_root := coalesce(r.recurrence_parent_id, r.id);
		INSERT INTO ride_posts (
			tenant_id, author_id, kind, origin_text, dest_text,
			origin_lat, origin_lng, dest_lat, dest_lng, depart_at,
			seats_total, seats_available, notes, women_only, recurrence, recurrence_parent_id
		) VALUES (
			r.tenant_id, r.author_id, 'offer', r.origin_text, r.dest_text,
			r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng, v_next,
			r.seats_total, r.seats_total, r.notes, r.women_only, r.recurrence, v_root
		)
		ON CONFLICT (recurrence_parent_id, depart_at) DO NOTHING;
		IF FOUND THEN
			v_spawned := v_spawned + 1;
		END IF;
	END LOOP;

	RETURN QUERY SELECT v_completed, v_expired, v_spawned;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_rides_sweep(text, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_rides_sweep(text, integer) TO campusos_app';
	END IF;
END
$$;
