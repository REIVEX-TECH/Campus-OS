-- Campus OS database bootstrap for DEVELOPMENT and CI.
-- Run ONCE as a superuser (e.g. `postgres`):
--
--   psql -U postgres -h localhost -f scripts/db-bootstrap.sql
--
-- Creates TWO least-privilege roles and two databases:
--   * campusos_owner — owns the databases, the schema, and every object in it.
--                      Runs migrations. Never used at runtime.
--   * campusos_app   — the runtime role. Owns nothing. Holds SELECT, INSERT,
--                      UPDATE and DELETE, and nothing else.
--
-- Why two roles. Row-level security does not apply to a table's owner unless the
-- table sets FORCE. While the application WAS the owner, every table needed
-- FORCE to stay isolated, and a SECURITY DEFINER function could gain nothing,
-- because it elevated to the role already calling it. Splitting them makes the
-- ownership boundary real: RLS applies to the application because it owns
-- nothing, and a definer function can do the one privileged read that session
-- resolution needs.
--
-- The application role deliberately has NO TRUNCATE. TRUNCATE ignores RLS, so a
-- runtime role able to run it could empty every tenant in one statement.
-- It also has no CREATE on the schema: it never makes tables.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_owner') THEN
    CREATE ROLE campusos_owner WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      PASSWORD 'campusos_dev_password';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
    CREATE ROLE campusos_app WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      PASSWORD 'campusos_dev_password';
  END IF;
END
$$;

-- CREATE DATABASE cannot run inside a transaction or DO block; \gexec runs the
-- generated statement only when the database does not already exist.
SELECT 'CREATE DATABASE campusos_dev OWNER campusos_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos_dev')\gexec

SELECT 'CREATE DATABASE campusos_test OWNER campusos_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos_test')\gexec

\connect campusos_dev
\ir db-grants.sql

\connect campusos_test
\ir db-grants.sql
