-- Widen the sign in lookup to the rest of the public identity.
--
-- 0003 returned only what sign in strictly needed. Now that a signed in person
-- has a profile to show, the same lookup also carries the avatar seed and when
-- the handle last changed, so signing in does not need a second read.
--
-- Still nothing private beyond the email, which the caller needs in order to
-- reconcile an address that changed upstream. The function remains a single
-- exact-match lookup on the provider subject: without the exact subject from a
-- token Google signed it returns nothing, so it cannot enumerate users.

DROP FUNCTION IF EXISTS auth_resolve_user_by_subject(text);
--> statement-breakpoint

CREATE FUNCTION auth_resolve_user_by_subject(p_google_sub text)
	RETURNS TABLE (
		user_id uuid,
		handle text,
		email text,
		avatar_seed text,
		handle_changed_at timestamptz
	)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT u.id, u.handle, u.email, u.avatar_seed, u.handle_changed_at
	FROM users u
	WHERE u.google_sub = p_google_sub
	  AND u.status = 'active'
	LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_resolve_user_by_subject(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_resolve_user_by_subject(text) TO campusos_app';
	END IF;
END
$$;
