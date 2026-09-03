-- Activity timing, and nothing about where.
--
-- The dashboard needs two marks per person: when they last signed in and when
-- they were last seen. last_seen_at already existed on users and was never
-- written; last_login_at is new. Both are timing only. The decision that
-- nothing about a request's origin is stored is made permanent here by dropping
-- the two ip_hash columns: sessions.ip_hash was written and never shown,
-- audit_log.ip_hash was never written at all. A column that must never be
-- displayed is better absent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "ip_hash";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN IF EXISTS "ip_hash";
--> statement-breakpoint

-- Three definer functions, because users and sessions are visible only to their
-- owner and a tenant administrator is not that owner. Each answers for ONE
-- tenant and returns counts or a coarse bucket, never a timestamp of anyone in
-- particular. They read users, sessions and tenant_memberships, none of which
-- has FORCE (the invariant test pins that), so the owner they run as can see the
-- rows. The application checks view-analytics, or manage-members for the
-- bucket, inside the transaction before calling any of them.

-- How many members, and how many of them were seen in the last day, week, month.
CREATE OR REPLACE FUNCTION auth_tenant_activity_totals(p_tenant_id text)
	RETURNS TABLE (members int, active_day int, active_week int, active_month int)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT count(*)::int,
	       count(*) FILTER (WHERE u.last_seen_at >= now() - interval '1 day')::int,
	       count(*) FILTER (WHERE u.last_seen_at >= now() - interval '7 days')::int,
	       count(*) FILTER (WHERE u.last_seen_at >= now() - interval '30 days')::int
	FROM tenant_memberships m
	JOIN users u ON u.id = m.user_id
	WHERE m.tenant_id = p_tenant_id
	  AND m.status = 'active';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_tenant_activity_totals(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_tenant_activity_totals(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Per day, in the tenant's timezone, for the last p_days days including today:
-- sessions issued to members (sign ins), and members whose last seen mark falls
-- on that day. Every day is present, zero or not.
CREATE OR REPLACE FUNCTION auth_tenant_activity_days(p_tenant_id text, p_days int, p_timezone text)
	RETURNS TABLE (day date, sign_ins int, last_active int)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	WITH bounds AS (
		SELECT (now() AT TIME ZONE p_timezone)::date AS today,
		       now() - make_interval(days => p_days) AS since
	),
	days AS (
		SELECT generate_series(b.today - (p_days - 1), b.today, interval '1 day')::date AS day
		FROM bounds b
	),
	members AS (
		SELECT m.user_id
		FROM tenant_memberships m
		WHERE m.tenant_id = p_tenant_id
		  AND m.status = 'active'
	),
	sign_ins AS (
		SELECT (s.created_at AT TIME ZONE p_timezone)::date AS day, count(*)::int AS n
		FROM sessions s
		JOIN members mb ON mb.user_id = s.user_id
		CROSS JOIN bounds b
		WHERE s.created_at >= b.since
		GROUP BY 1
	),
	seen AS (
		SELECT (u.last_seen_at AT TIME ZONE p_timezone)::date AS day, count(*)::int AS n
		FROM users u
		JOIN members mb ON mb.user_id = u.id
		CROSS JOIN bounds b
		WHERE u.last_seen_at >= b.since
		GROUP BY 1
	)
	SELECT d.day, coalesce(si.n, 0), coalesce(se.n, 0)
	FROM days d
	LEFT JOIN sign_ins si ON si.day = d.day
	LEFT JOIN seen se ON se.day = d.day
	ORDER BY d.day;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_tenant_activity_days(text, int, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_tenant_activity_days(text, int, text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- A coarse bucket per member for the member list: day, week, month, older, or
-- never. Deliberately not the timestamp: the list shows how recently, never when.
CREATE OR REPLACE FUNCTION auth_tenant_member_activity(p_tenant_id text)
	RETURNS TABLE (user_id uuid, bucket text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT m.user_id,
	       CASE
	         WHEN u.last_seen_at >= now() - interval '1 day' THEN 'day'
	         WHEN u.last_seen_at >= now() - interval '7 days' THEN 'week'
	         WHEN u.last_seen_at >= now() - interval '30 days' THEN 'month'
	         WHEN u.last_seen_at IS NOT NULL THEN 'older'
	         ELSE 'never'
	       END
	FROM tenant_memberships m
	JOIN users u ON u.id = m.user_id
	WHERE m.tenant_id = p_tenant_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_tenant_member_activity(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_tenant_member_activity(text) TO campusos_app';
	END IF;
END
$$;
