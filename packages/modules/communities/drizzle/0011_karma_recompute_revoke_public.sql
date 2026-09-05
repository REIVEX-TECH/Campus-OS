-- Finish taking EXECUTE on the karma rebuild away from the application.
--
-- communities_karma_recompute is owner-only by design: it deletes and rebuilds a
-- tenant's karma and reads every author, anonymous included, so nothing a request
-- runs may call it (its only caller, recomputeKarma, uses the owner connection).
-- 0010 revoked the BY-NAME grant (campusos_app=X, planted by ALTER DEFAULT
-- PRIVILEGES in scripts/db-grants.sql) but left the ambient PUBLIC EXECUTE that
-- every function carries at creation -- 0006 never revoked FROM PUBLIC. So
-- has_function_privilege('campusos_app', ..., 'execute') stayed TRUE (via PUBLIC)
-- and the application role could still invoke the rebuild: a live privilege hole,
-- latent only because the invariant test that would catch it never ran.
--
-- The canonical owner-only pattern (auth_attach_role_internal, 0019) is BOTH
-- revokes; 0010 did only one. This adds the missing FROM PUBLIC and re-asserts the
-- by-name revoke, so the lock is complete whatever the grant state. On an unsplit
-- development database the app owns the function and keeps it implicitly (the
-- guarantee cannot hold there anyway); where the roles are split, the application
-- loses EXECUTE entirely and the owner keeps it by ownership.
REVOKE ALL ON FUNCTION communities_karma_recompute(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'REVOKE ALL ON FUNCTION communities_karma_recompute(text) FROM campusos_app';
	END IF;
END
$$;
