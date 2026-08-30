-- Campus OS database bootstrap. Run ONCE as a superuser (e.g. `postgres`).
--
--   psql -U postgres -h localhost -f scripts/db-bootstrap.sql
--
-- Creates a least-privilege, NOSUPERUSER role and two databases owned by it:
--   * campusos_dev   — local development
--   * campusos_test  — integration tests (reset by the suite)
--
-- The app connects as `campusos_app` for BOTH migrations and runtime. Because
-- this role is NOT a superuser and every tenant-scoped table has
-- FORCE ROW LEVEL SECURITY, it cannot read across tenants even though it owns
-- the tables. (A superuser WOULD bypass RLS — that is why the app must never
-- use one.) Splitting migration vs. runtime roles is a production follow-up.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
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
SELECT 'CREATE DATABASE campusos_dev OWNER campusos_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos_dev')\gexec

SELECT 'CREATE DATABASE campusos_test OWNER campusos_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos_test')\gexec

-- Give campusos_app ownership of the public schema in each database so it can
-- create tables during migration. (Postgres 15+ no longer grants this to
-- PUBLIC by default.)
\connect campusos_dev
ALTER SCHEMA public OWNER TO campusos_app;
GRANT ALL ON SCHEMA public TO campusos_app;

\connect campusos_test
ALTER SCHEMA public OWNER TO campusos_app;
GRANT ALL ON SCHEMA public TO campusos_app;
