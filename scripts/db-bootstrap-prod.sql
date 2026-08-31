-- CampusOS production bootstrap for a SHARED Postgres cluster.
--
-- Creates ONLY the `campusos_app` login role and the `campusos` database, and
-- makes `campusos_app` own that database's `public` schema so migrations can
-- create tables. It touches NOTHING else on the cluster: the guards make it
-- idempotent and it never drops or alters other roles/databases.
--
-- Run as a superuser (e.g. postgres), passing the app password at runtime so it
-- never lands in this file:
--
--   sudo -u postgres psql -v app_password="CHOOSE_A_STRONG_PASSWORD" \
--     -f scripts/db-bootstrap-prod.sql
--
-- CRITICAL: the role is NOBYPASSRLS. Without it, row-level security is void and
-- tenants could read each other's data. Avoid a single quote (') in the password
-- to keep the literal simple.

-- 1. The least-privilege app role, created only if it does not already exist.
SELECT format(
  'CREATE ROLE campusos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
\gexec

-- 2. The app database, owned by the app role, created only if absent. Other
--    databases on this cluster are left untouched.
SELECT 'CREATE DATABASE campusos OWNER campusos_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos')
\gexec

-- 3. Inside the campusos database, ensure the app role owns the public schema so
--    `pnpm db:migrate:all` can create the schema, tables, and RLS policies.
\connect campusos
ALTER SCHEMA public OWNER TO campusos_app;
GRANT ALL ON SCHEMA public TO campusos_app;
