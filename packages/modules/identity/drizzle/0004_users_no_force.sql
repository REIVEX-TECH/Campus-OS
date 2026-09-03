-- users drops FORCE, for exactly the reason sessions did in 0002.
--
-- FORCE ROW LEVEL SECURITY exists to apply a policy to a table's OWNER. It was
-- needed while the application connected as the owner. It no longer does: the
-- application owns nothing, so the own-row policy binds it regardless, and
-- nothing about what the application can see changes here.
--
-- What it does change is that a SECURITY DEFINER function owned by the schema
-- owner can read the table. auth_resolve_user_by_subject (0003) needs exactly
-- that: sign in holds a verified Google subject but not yet a user id, so the
-- lookup cannot satisfy a policy keyed on the user's own id. Without this the
-- function silently returned nothing and every second sign in tried to insert a
-- duplicate user.
--
-- FORCE stays on every tenant-scoped table, where it remains a genuine safety
-- net if the application is ever pointed at the owner credential.

ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
