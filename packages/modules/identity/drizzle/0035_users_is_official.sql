-- An official-account marker on the account. is_official marks a first-party
-- platform/campus account (the one that announces a module launch, or re-posts a
-- lost item into the right module with a link back). It is the authorization input
-- for the communities rule "an official account may post in any community, subject
-- to the structural rules" (see packages/modules/communities/src/posts.ts): the
-- membership, verification, karma and account-age gates are waived for it, the
-- content rules are not.
--
-- §8: an authorization decision must not key on a value the application can write.
-- The `own_user` policy (0001) lets a user write their own row, which would let any
-- real user flip their own is_official to true and post anywhere. So a RESTRICTIVE
-- policy scoped to campusos_app forbids the app role from ever writing
-- is_official = true (on insert or update); only an owner-run promote/seed sets it.
-- This is an RLS policy (not a column grant), so it is independent of db-grants'
-- blanket table grant and survives its re-application. Skipped on an unsplit dev
-- database (app == owner) where the guarantee cannot hold anyway.

ALTER TABLE "users" ADD COLUMN "is_official" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND NOT EXISTS (
	     SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
	     WHERE c.relname = 'users' AND r.rolname = 'campusos_app'
	   ) THEN
		EXECUTE 'CREATE POLICY "users_app_not_official" ON "users" AS RESTRICTIVE FOR ALL TO campusos_app USING (true) WITH CHECK ("is_official" = false)';
	END IF;
END
$$;
--> statement-breakpoint
-- The public badge reads through public_profiles (0005): the sanctioned public
-- half of an identity. is_official is a public, non-sensitive fact (its whole
-- purpose is to be shown), so it belongs here alongside the handle and avatar and
-- nothing sensitive. CREATE OR REPLACE appends the column at the end, which is the
-- only shape of view change this form allows.
CREATE OR REPLACE VIEW public_profiles AS
	SELECT u.id AS user_id, u.handle, u.avatar_seed, u.is_official
	FROM users u
	WHERE u.status = 'active';
