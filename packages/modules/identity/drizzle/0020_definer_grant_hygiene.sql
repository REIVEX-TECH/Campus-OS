-- The one owner-only definer still inheriting the application's EXECUTE grant.
--
-- `audit_log_stamp_grant` is a BEFORE INSERT trigger function (0018): it is fired
-- by the trigger, never called by a request, so the application has no business
-- executing it directly. But like every function the owner creates it inherited
-- EXECUTE for campusos_app from the default privileges (db-grants), and 0018
-- neither granted nor revoked it. A trigger fires regardless of the invoking
-- user's EXECUTE privilege, so revoking it from the application changes nothing
-- about the audit stamp and removes a direct-call surface that should not exist.
--
-- This is the same REVOKE-BY-NAME rule as communities_karma_recompute (0010) and
-- auth_attach_role_internal (0019); the new invariant test that accompanies this
-- migration now enforces it for EVERY definer, so a future owner-only function
-- that silently inherits the grant fails CI by construction rather than being
-- caught, twice, only by an adversarial read.
--
-- Two grants must go: 0018 created this function with neither a REVOKE nor a
-- GRANT, so it carries BOTH the default PUBLIC EXECUTE and the campusos_app
-- entry from ALTER DEFAULT PRIVILEGES. `has_function_privilege` is true if
-- either stands, so both are removed: PUBLIC unconditionally (as every other
-- definer does), and campusos_app by name (split-guarded).
REVOKE ALL ON FUNCTION audit_log_stamp_grant() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	-- Split database only, and only when the app is not the owner: on an unsplit
	-- development database the app owns the function and the guarantee cannot
	-- hold there anyway.
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND (
	     SELECT pg_get_userbyid(p.proowner) <> 'campusos_app'
	     FROM pg_proc p
	     WHERE p.proname = 'audit_log_stamp_grant'
	       AND p.pronamespace = 'public'::regnamespace
	     LIMIT 1
	   )
	THEN
		EXECUTE 'REVOKE ALL ON FUNCTION audit_log_stamp_grant() FROM campusos_app';
	END IF;
END
$$;
