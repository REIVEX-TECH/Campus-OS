-- Verify the role split in the CURRENT database. Read-only.
--
--   psql -d campusos -f scripts/db-verify.sql
--
-- Used by CI after bootstrap, and by docs/db-role-split.md step 5, so the check
-- that guards production is the same one that runs on every build.

\echo '--- database and schema ownership ---'
SELECT current_database() AS database,
       pg_get_userbyid(datdba) AS database_owner
FROM pg_database
WHERE datname = current_database();

SELECT nspname AS schema, pg_get_userbyid(nspowner) AS schema_owner
FROM pg_namespace
WHERE nspname IN ('public', 'drizzle');

\echo '--- what each role may do to this database ---'
SELECT r.rolname AS role,
       has_database_privilege(r.rolname, current_database(), 'CONNECT') AS can_connect,
       has_database_privilege(r.rolname, current_database(), 'CREATE') AS can_create,
       r.rolbypassrls AS bypasses_rls,
       r.rolsuper AS is_superuser
FROM pg_roles r
WHERE r.rolname IN ('campusos_owner', 'campusos_app')
ORDER BY r.rolname;

\echo '--- tables still owned by the application role (expect 0) ---'
SELECT count(*) AS owned_by_app
FROM pg_class c
JOIN pg_roles r ON r.oid = c.relowner
WHERE r.rolname = 'campusos_app' AND c.relkind = 'r';
