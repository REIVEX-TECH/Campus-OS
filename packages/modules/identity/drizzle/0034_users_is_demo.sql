-- A seeded demo persona marker on the account (design-demo-tenant.md). is_demo
-- distinguishes fixtures from real visitors and is the authorization input for the
-- demo tenant's "real users are read-only" rule (H): a gate allows a mutation on a
-- demo tenant only when the actor is a persona (actor.is_demo).
--
-- §8: an authorization decision must not key on a value the application can write.
-- The `own_user` policy (0001) lets a user write their own row, which would let a
-- real user flip their own is_demo to true and escape the read-only rule. So a
-- RESTRICTIVE policy scoped to campusos_app forbids the app role from ever writing
-- is_demo = true (on insert or update); only the owner-run demo seed sets it. This is
-- an RLS policy (not a column grant), so it is independent of db-grants' blanket
-- table grant and survives its re-application. Skipped on an unsplit dev database
-- (app == owner) where the guarantee cannot hold anyway.

ALTER TABLE "users" ADD COLUMN "is_demo" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND NOT EXISTS (
	     SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
	     WHERE c.relname = 'users' AND r.rolname = 'campusos_app'
	   ) THEN
		EXECUTE 'CREATE POLICY "users_app_not_demo" ON "users" AS RESTRICTIVE FOR ALL TO campusos_app USING (true) WITH CHECK ("is_demo" = false)';
	END IF;
END
$$;
