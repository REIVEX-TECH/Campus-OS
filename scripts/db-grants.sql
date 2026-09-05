-- The privilege split, applied inside ONE database. Included by the bootstrap
-- scripts and by the production role-split runbook, so development, CI, and
-- production end up with exactly the same grants rather than three dialects of
-- roughly the same idea.
--
-- Assumes campusos_owner and campusos_app already exist and that
-- campusos_owner owns this database. Idempotent: safe to re-run.

-- The owner owns the schema and everything created in it. The database grant is
-- implicit for an owner, but stating it means the split does not depend on the
-- database having been created with the right OWNER in the first place.
SELECT format('GRANT ALL ON DATABASE %I TO campusos_owner', current_database())\gexec
ALTER SCHEMA public OWNER TO campusos_owner;

-- The application connects, reads and writes rows, and does nothing else.
-- No CREATE (it never makes tables) and no TRUNCATE (TRUNCATE ignores RLS, so a
-- runtime role holding it could empty every tenant in a single statement).
-- GRANT needs a literal database name, so generate it for whichever database
-- this file is being included into.
SELECT format('GRANT CONNECT ON DATABASE %I TO campusos_app', current_database())\gexec
GRANT USAGE ON SCHEMA public TO campusos_app;
REVOKE CREATE ON SCHEMA public FROM campusos_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campusos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campusos_app;

-- EXECUTE is granted here ONLY on plain (non-definer) functions. Every SECURITY
-- DEFINER function decides its own access in its migration: an app-callable
-- definer GRANTs itself to campusos_app there, and an owner-only definer (e.g.
-- communities_karma_recompute, auth_attach_role_internal) deliberately withholds
-- it with a REVOKE ... FROM PUBLIC and a by-name revoke.
--
-- A blanket `GRANT EXECUTE ON ALL FUNCTIONS ... TO campusos_app` is a hazard on a
-- RE-RUN: run once the schema already exists (this file bills itself re-runnable,
-- and the production role-split runbook includes it after migrating), it silently
-- re-grants EXECUTE by name on every owner-only definer, and nothing revokes it
-- again -- re-opening exactly the privilege holes those migrations closed. So
-- definers are excluded here. The DEFINER_INTENT invariant test enforces the
-- matching promise (every app-callable definer grants itself explicitly), and an
-- integration test re-applies this loop after migrating to prove the exclusion
-- holds. prokind is restricted to plain and window functions: `GRANT EXECUTE ON
-- FUNCTION` errors on a PROCEDURE (which needs ON PROCEDURE/ROUTINE), and under
-- ON_ERROR_STOP that would abort the whole file, so procedures are skipped as the
-- old `GRANT EXECUTE ON ALL FUNCTIONS` did.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT p.prosecdef
      AND p.prokind IN ('f', 'w')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO campusos_app', fn);
  END LOOP;
END
$$;

-- Tables the owner creates later (every future migration) are usable by the
-- application without anyone remembering to come back here.
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO campusos_app;
