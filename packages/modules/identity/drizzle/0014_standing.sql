-- Membership for everyone, and standing that says why.
--
-- Three things about a person in a tenant are separate: what they may do
-- (roles), whether the university has confirmed who they are (verified_at),
-- and whether they may act at all (status). Until now status was a bare word
-- with no reason, no actor and no end, and the only word it ever took besides
-- `active` was `suspended`, which read as an account punishment while behaving
-- as read-only.
--
-- So: `restricted` is the honest name for what that already did, `suspended`
-- becomes the heavier thing it always sounded like, and both carry the three
-- facts a person is owed about a decision made against them.
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "standing_reason" text;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "standing_until" timestamptz;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "standing_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "standing_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "appeal_note" text;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "appeal_at" timestamptz;
--> statement-breakpoint

-- What `suspended` meant until today is what `restricted` means from now on:
-- read everything, write nothing. Nobody is newly locked out by this migration.
UPDATE "tenant_memberships" SET "status" = 'restricted' WHERE "status" = 'suspended';
--> statement-breakpoint

-- A standing that has run out is not a standing. The read paths compare against
-- now(), so an expiry needs no job; this index keeps the comparison cheap for
-- the administrator's list of who is currently under one.
CREATE INDEX IF NOT EXISTS "tenant_memberships_standing_idx"
	ON "tenant_memberships" ("tenant_id", "status")
	WHERE "status" <> 'active';
--> statement-breakpoint

-- The effective permission resolver already required an active membership, so
-- a restricted or suspended person resolves to nothing there. That is the read
-- side of the same fact and needs no change; what does change is that an
-- expired standing must stop counting, or a restriction would outlive its own
-- end date in every permission check.
CREATE OR REPLACE FUNCTION auth_effective_permissions(p_user_id uuid, p_tenant_id text)
	RETURNS TABLE (permission text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT DISTINCT rp.permission
	FROM membership_roles mr
	JOIN tenant_memberships m ON m.id = mr.membership_id
	JOIN role_permissions rp ON rp.role_id = mr.role_id
	WHERE mr.user_id = p_user_id
	  AND mr.tenant_id = p_tenant_id
	  AND (m.status = 'active' OR (m.standing_until IS NOT NULL AND m.standing_until <= now()));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_effective_permissions(uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_effective_permissions(uuid, text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The new permission joins the administrator's definition, and every tenant's
-- copy of it, in the same migration that creates the thing it guards.
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'restrict-members')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE
	v_slug text;
BEGIN
	FOR v_slug IN SELECT slug FROM universities LOOP
		PERFORM auth_sync_tenant_roles(v_slug);
	END LOOP;
END
$$;
