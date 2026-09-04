-- platform_roles becomes a table the application cannot write directly.
--
-- Today `own_platform_role` is FOR ALL with `user_id = app.user_id`, so the
-- database itself permits any signed-in request to INSERT its own
-- `platform_admin` row. Nothing in the application does that -- the one writer,
-- `ensurePlatformAdmin`, checks the environment allowlist first -- but the
-- database does not know that, and a future code path or an injected INSERT
-- would be allowed by the row policy. Cross-tenant administration is about to
-- be built on this table; it must not be one the app role can write itself into.
--
-- So the read stays and the write leaves the app role's hands entirely. The
-- only way a `platform_admin` row is written from here on is
-- `auth_grant_platform_admin`, a SECURITY DEFINER that promotes the CALLER and
-- no one else: it reads the caller's own verified email from `users` by
-- `app.user_id`, which the caller cannot forge, and writes the row only if that
-- email is on the allowlist it is handed. A raw `INSERT INTO platform_roles`
-- now matches no policy and fails.
--
-- The environment stays the master key: the allowlist is `SUPERADMIN_EMAILS`,
-- passed in by the sign-in route exactly as `ensurePlatformAdmin` passed it to
-- `isAllowlisted` before. What changes is that the promotion, the allowlist
-- check and the audit line are now one indivisible act inside the database
-- rather than a check in TypeScript followed by a write the policy waved through.

-- platform_roles loses FORCE, for the reason every other table a definer writes
-- has lost it: FORCE makes the row policies bind the table's owner too, and the
-- definer below runs as the owner and must INSERT. With no INSERT policy (that
-- is the whole point -- the application must not write this table) a FORCEd
-- owner is denied its own insert. Dropping FORCE lets the owner, and only the
-- owner, write it; the application role is a NON-owner, so RLS still binds it to
-- the SELECT-only policy below and nothing it can run writes the table.
ALTER TABLE "platform_roles" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Replace the FOR ALL policy (which let `user_id = app.user_id` INSERT its own
-- row) with SELECT-only.
DROP POLICY IF EXISTS "own_platform_role" ON "platform_roles";
--> statement-breakpoint
CREATE POLICY "own_platform_role_read" ON "platform_roles" FOR SELECT
	USING ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
-- No INSERT, UPDATE or DELETE policy exists for the application role. Under RLS
-- that is default-deny: the app cannot write this table by any statement. The
-- owner (migrations, and the definer below, which runs as the owner) is the
-- only writer.

-- Promote the caller to platform_admin, once, if their verified email is on the
-- allowlist. Returns true only when a row was written now.
--
-- Reads the email from `users` by `app.user_id`, so it can only ever promote
-- the person making the call: there is no argument for "which user", by design,
-- so it cannot be turned on a third party. The allowlist is validated here too
-- -- each entry must be a real address -- so a stray "@" that slipped through
-- the caller's parsing cannot match an account. Writes the audit line in the
-- same statement as the grant, so an unlogged promotion cannot exist.
CREATE OR REPLACE FUNCTION auth_grant_platform_admin(p_allowlist text[])
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_email text;
	v_ok boolean;
BEGIN
	IF v_user IS NULL THEN
		RETURN false;
	END IF;
	SELECT lower(email) INTO v_email FROM users WHERE id = v_user;
	IF v_email IS NULL THEN
		RETURN false;
	END IF;
	-- On the list, comparing whole addresses, and only entries that are real
	-- addresses count: a bare "@" or empty string is not a wildcard.
	SELECT EXISTS (
		SELECT 1 FROM unnest(p_allowlist) AS a(entry)
		WHERE lower(trim(a.entry)) = v_email
		  AND a.entry ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
	) INTO v_ok;
	IF NOT v_ok THEN
		RETURN false;
	END IF;

	INSERT INTO platform_roles (user_id, role)
	VALUES (v_user, 'platform_admin')
	ON CONFLICT (user_id) DO NOTHING;
	IF NOT FOUND THEN
		-- Already a platform admin; nothing written, nothing to log.
		RETURN false;
	END IF;

	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, NULL, 'platform.admin_granted', 'user', v_user::text,
	        jsonb_build_object('source', 'env'));
	RETURN true;
END;
$$;
--> statement-breakpoint

-- The application calls this at sign in, so it may EXECUTE it; PUBLIC may not.
REVOKE ALL ON FUNCTION auth_grant_platform_admin(text[]) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_grant_platform_admin(text[]) TO campusos_app';
	END IF;
END
$$;
