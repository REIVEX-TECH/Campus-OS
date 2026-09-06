-- Drop the one-time config-admin conversion tool now that its job is done.
--
-- auth_migrate_configured_admin (0023) converted each config `adminEmails` admin
-- into a real tenant_membership. It ran once in production (3a), and its only
-- caller, scripts/migrate-configured-admins.ts, was deleted when config-admin
-- seeding was retired (3b). A dead owner-only definer that still seeds tenant_admin
-- for an arbitrary email is exactly the dead-primitive pattern this project
-- removes rather than leaves behind: drop it so it cannot be reached at all. The
-- 0023 migration remains in history; this is its retirement.
DROP FUNCTION IF EXISTS auth_migrate_configured_admin(text, text);
