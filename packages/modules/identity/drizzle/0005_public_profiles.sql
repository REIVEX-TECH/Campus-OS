-- The public half of an identity, and the reservation check that protects it.
--
-- public_profiles is the sanctioned way to read someone's public identity. It
-- exposes the handle and the avatar seed and NOTHING else, so a join for a
-- future post or comment cannot accidentally carry an email along with it. The
-- protection is structural: the email is not a column of this view, so no query
-- against it can select one.

CREATE OR REPLACE VIEW public_profiles AS
	SELECT u.id AS user_id, u.handle, u.avatar_seed
	FROM users u
	WHERE u.status = 'active';
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT ON public_profiles TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Is this handle reserved by somebody else who recently gave it up?
--
-- A released handle stays unavailable for a window so that nobody can pick up a
-- name someone has just left and be mistaken for them. The rows live in
-- handle_history and belong to their former owner, so the person asking cannot
-- read them under the own-row policy. This answers the single yes or no question
-- they are entitled to, and reveals nothing about whose handle it was.
CREATE OR REPLACE FUNCTION auth_handle_is_reserved(p_handle text, p_user_id uuid)
	RETURNS TABLE (reserved boolean)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM handle_history h
		WHERE lower(h.handle) = lower(p_handle)
		  AND h.user_id <> p_user_id
		  AND h.reserved_until > now()
	);
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_handle_is_reserved(text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_handle_is_reserved(text, uuid) TO campusos_app';
	END IF;
END
$$;
