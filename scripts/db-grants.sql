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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO campusos_app;

-- Tables the owner creates later (every future migration) are usable by the
-- application without anyone remembering to come back here.
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO campusos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campusos_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO campusos_app;
