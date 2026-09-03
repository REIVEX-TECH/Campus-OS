-- CampusOS production bootstrap for a SHARED Postgres cluster, FRESH install.
--
-- If you already have a `campusos` database whose objects are owned by
-- campusos_app, do NOT run this. Use docs/db-role-split.md instead, which moves
-- an existing database onto the two-role layout without losing data.
--
-- Creates two least-privilege roles and the `campusos` database:
--   * campusos_owner — owns the database, the schema, and every object in it.
--                      Runs migrations. Never used at runtime.
--   * campusos_app   — the runtime role. Owns nothing. SELECT, INSERT, UPDATE
--                      and DELETE only.
--
-- Why two. Row-level security does not apply to a table's owner unless the table
-- sets FORCE, so while the application was the owner every table needed FORCE,
-- and a SECURITY DEFINER function gained nothing because it elevated to the role
-- already calling it. With the roles split, RLS applies to the application
-- because it owns nothing, and session resolution can do its one privileged read.
--
-- The application role has NO TRUNCATE on purpose: TRUNCATE ignores RLS, so a
-- runtime role holding it could empty every tenant in one statement.
--
-- It touches NOTHING else on the cluster: the guards make it idempotent and it
-- never drops or alters other roles or databases.
--
-- Run as a superuser, passing both passwords at runtime so neither lands in this
-- file. Use different passwords, and avoid a single quote (') in either:
--
--   sudo -u postgres psql \
--     -v owner_password="CHOOSE_A_STRONG_PASSWORD" \
--     -v app_password="CHOOSE_A_DIFFERENT_STRONG_PASSWORD" \
--     -f scripts/db-bootstrap-prod.sql
--
-- CRITICAL: both roles are NOBYPASSRLS. Without that, row-level security is void
-- and tenants could read each other's data.

-- 1. The owner role: owns the schema, runs migrations, never serves traffic.
SELECT format(
  'CREATE ROLE campusos_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
  :'owner_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_owner')
\gexec

-- 2. The runtime role: owns nothing, so RLS always applies to it.
SELECT format(
  'CREATE ROLE campusos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
\gexec

-- 3. The app database, owned by the OWNER role. Other databases on this cluster
--    are left untouched.
SELECT 'CREATE DATABASE campusos OWNER campusos_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'campusos')
\gexec

-- 4. The privilege split, shared with development and CI so all three agree.
\connect campusos
\ir db-grants.sql
