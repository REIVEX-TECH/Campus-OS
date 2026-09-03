-- Session resolution, now that the application role and the schema owner are
-- two different roles (see docs/db-role-split.md).
--
-- Resolving a request's session happens BEFORE the user is known: we hold a
-- token, not a user id, so the read cannot satisfy the own-row policy on
-- sessions. The first attempt at this was a SECURITY DEFINER function, which did
-- nothing, because the application connected as the table owner: the function
-- elevated to the role already calling it, and FORCE ROW LEVEL SECURITY applied
-- the policy to the owner anyway.
--
-- With the roles split, SECURITY DEFINER means something again. Two changes make
-- the lookup work without loosening anything the application can do:
--
--  1. sessions drops FORCE. FORCE existed only because the application WAS the
--     owner. It no longer is, so RLS applies to it regardless, and the own-row
--     policy below is unchanged. Dropping FORCE lets the owner (and only the
--     owner) read the table, which is what the definer function needs.
--     FORCE stays on every tenant-scoped table: there it is a genuine safety net
--     if anyone ever points the application at the owner credential.
--
--  2. The function is SECURITY DEFINER, owned by the schema owner, takes a hash
--     rather than a token, returns at most one row on an exact match, and pins
--     its search_path. It cannot enumerate: without the exact hash of a live
--     token it returns nothing.

ALTER TABLE "sessions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_resolve_session(p_token_hash text)
	RETURNS TABLE (user_id uuid, session_id uuid, expires_at timestamptz)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT s.user_id, s.id, s.expires_at
	FROM sessions s
	WHERE s.token_hash = p_token_hash
	  AND s.revoked_at IS NULL
	  AND s.expires_at > now()
	LIMIT 1;
$$;
--> statement-breakpoint

-- Nobody gets it by default; the runtime role gets exactly this one function.
REVOKE ALL ON FUNCTION auth_resolve_session(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_resolve_session(text) TO campusos_app';
	END IF;
END
$$;
