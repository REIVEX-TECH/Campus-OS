-- The second, and last, privileged read: find a user by the provider's subject.
--
-- Sign in has the same shape as session resolution. We hold a verified token
-- naming a Google subject, but not yet a user id, so the read cannot satisfy the
-- own-row policy on users. Rather than widen that policy, this is a definer
-- function with a single exact-match lookup: without the exact subject from a
-- token Google signed, it returns nothing, so it cannot enumerate users.
--
-- It returns only what sign in needs. The email is included because an address
-- can change upstream and the caller reconciles it; nothing else about the user
-- leaves this function.

CREATE OR REPLACE FUNCTION auth_resolve_user_by_subject(p_google_sub text)
	RETURNS TABLE (user_id uuid, handle text, email text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT u.id, u.handle, u.email
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
