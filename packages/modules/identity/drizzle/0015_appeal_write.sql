-- The one write a restricted person may make: their appeal note.
--
-- Memberships are deliberately out of the user's hands. `memberships_update`
-- requires a tenant context, which is what makes "verified" unforgeable rather
-- than merely hidden, and the appeal write ran without one, so it matched no
-- rows and said nothing. Granting the user a tenant context instead would put
-- status and verified_at within reach of any path that takes a user id, and
-- Postgres has no column-scoped policy to stop that.
--
-- So the write goes through the owner, in a function that takes no user id at
-- all: it reads the caller from the session setting, so a person can only ever
-- appeal for themselves, and touches exactly two columns. tenant_memberships
-- has no FORCE (0010), so the definer can write it.
CREATE OR REPLACE FUNCTION auth_appeal_standing(p_tenant_id text, p_note text)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user text := current_setting('app.user_id', true);
	v_updated integer;
BEGIN
	IF v_user IS NULL OR v_user = '' THEN
		RETURN false;
	END IF;
	UPDATE tenant_memberships
	   SET appeal_note = p_note,
	       appeal_at = now()
	 WHERE tenant_id = p_tenant_id
	   AND user_id::text = v_user
	   -- An appeal is about a decision, so there has to be one standing.
	   AND status <> 'active'
	   AND (standing_until IS NULL OR standing_until > now());
	GET DIAGNOSTICS v_updated = ROW_COUNT;
	RETURN v_updated > 0;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_appeal_standing(text, text) TO campusos_app';
	END IF;
END
$$;
