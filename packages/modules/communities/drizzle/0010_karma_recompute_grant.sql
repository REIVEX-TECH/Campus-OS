-- Take EXECUTE on the karma rebuild away from the application, which it was
-- never meant to have and quietly did.
--
-- 0006 says of `communities_karma_recompute`: "Not granted to the application:
-- the owner runs it, from the script." That was wrong. `scripts/db-grants.sql`
-- ends with
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO campusos_app;
--
-- so every function the owner creates is EXECUTE-granted to the application at
-- the moment it is created. Saying nothing therefore grants it. The repository's
-- usual `REVOKE ALL ON FUNCTION ... FROM PUBLIC` does not help: it removes the
-- PUBLIC entry and leaves `campusos_app=X/campusos_owner` standing.
--
-- For every other definer function here that is the intended state, because the
-- application is what calls them and each does its own checks inside. This one
-- is different: it deletes and rebuilds a tenant's karma, and it reads every
-- author, including the authors of anonymous items. Nothing a request does
-- should be able to reach it.
--
-- The lesson generalises, and Phase 5 depends on it: a definer meant for the
-- owner alone must revoke from `campusos_app` BY NAME. FROM PUBLIC is not that.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'REVOKE ALL ON FUNCTION communities_karma_recompute(text) FROM campusos_app';
	END IF;
END
$$;
