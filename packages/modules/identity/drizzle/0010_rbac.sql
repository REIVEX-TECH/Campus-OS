-- Roles and permissions, per tenant.
--
-- Until now a membership carried one role in a text column, and every admin
-- surface asked the same question: "are you tenant_admin here". That made every
-- capability all or nothing, and it made granting one a deploy. Roles become
-- data a tenant owns, a person may hold several, and what a role can DO is a set
-- of permissions from a fixed catalogue in code, because a permission only means
-- something if some code checks it.
--
-- tenant_id is denormalised onto all three tables so every policy keys on it
-- directly instead of joining to discover which tenant a row belongs to.

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"key" text NOT NULL,
	"name" text NOT NULL,
	-- A role the tenant cannot delete: without it a tenant could remove the only
	-- role that lets it administer itself.
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_uq" ON "roles" ("tenant_id", "key");
--> statement-breakpoint

CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"permission" text NOT NULL,
	PRIMARY KEY ("role_id", "permission")
);
--> statement-breakpoint
CREATE INDEX "role_permissions_tenant_idx" ON "role_permissions" ("tenant_id");
--> statement-breakpoint

CREATE TABLE "membership_roles" (
	"membership_id" uuid NOT NULL REFERENCES "tenant_memberships"("id") ON DELETE CASCADE,
	"role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"granted_at" timestamptz DEFAULT now() NOT NULL,
	"granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	PRIMARY KEY ("membership_id", "role_id")
);
--> statement-breakpoint
CREATE INDEX "membership_roles_user_tenant_idx" ON "membership_roles" ("user_id", "tenant_id");
--> statement-breakpoint

-- RLS, deliberately WITHOUT FORCE on all three.
--
-- FORCE applies a table's policies to its owner, which is what a SECURITY
-- DEFINER function runs as, so a table with FORCE is one no definer function can
-- read: it gets filtered exactly as the caller would be and silently returns
-- nothing. That cost three separate fixes earlier in this project, so it is
-- stated once here: auth_effective_permissions below reads all three, therefore
-- none of them may have FORCE. The application owns nothing, so RLS still
-- applies to it in full.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Everything here is reachable only inside a tenant context, which only server
-- code sets. A member resolving their OWN permissions does not read these tables
-- at all; they call the definer function, which returns their permissions and
-- nobody else's. Keeping the policies narrow is what stops the permission check
-- from becoming the leak.
CREATE POLICY "roles_in_tenant" ON "roles"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "role_permissions_in_tenant" ON "role_permissions"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "membership_roles_in_tenant" ON "membership_roles"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant_memberships drops FORCE, because the function below joins it.
--
-- The fourth time this has come up, and the first caught by a test rather than
-- by a feature quietly doing nothing. FORCE applies a table's policies to its
-- owner, which is what a SECURITY DEFINER function runs as, so joining a FORCEd
-- table filters the function exactly as its caller would be filtered. Here that
-- made auth_effective_permissions return no rows at all: every member resolved
-- to no permissions, and every permission check would have failed closed and
-- silently. Failing closed is the safe direction, which is precisely why it
-- would have been hard to notice.
--
-- Nothing the application can see changes: it owns no tables, so the own-row and
-- tenant policies bind it either way. What FORCE protected against was the
-- application being pointed at the owner credential, which the role split made
-- a deployment mistake rather than a design.
ALTER TABLE "tenant_memberships" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- What may this person do in this tenant.
--
-- The union of the permissions of every role attached to their membership, and
-- only while that membership is active: a suspended member keeps their roles and
-- loses their permissions, which is what makes suspension worth having.
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
	  AND m.status = 'active';
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

-- Seed the three system roles for every tenant that already exists, and carry
-- the memberships already out there into the new model. Idempotent: re-running
-- adds nothing, so it is safe on a database that has been part migrated.
INSERT INTO "roles" ("tenant_id", "key", "name", "is_system")
SELECT u.slug, r.key, r.name, true
FROM "universities" u
CROSS JOIN (VALUES
	('student', 'Student'),
	('teacher', 'Teacher'),
	('tenant_admin', 'Administrator')
) AS r(key, name)
ON CONFLICT ("tenant_id", "key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, p.permission
FROM "roles" r
JOIN (VALUES
	('student', 'post'),
	('teacher', 'post'),
	('tenant_admin', 'manage-timetable'),
	('tenant_admin', 'manage-rooms'),
	('tenant_admin', 'approve-verifications'),
	('tenant_admin', 'manage-members'),
	('tenant_admin', 'manage-roles'),
	('tenant_admin', 'view-analytics'),
	('tenant_admin', 'post'),
	('tenant_admin', 'moderate')
) AS p(role_key, permission) ON p.role_key = r.key
WHERE r.is_system
ON CONFLICT ("role_id", "permission") DO NOTHING;
--> statement-breakpoint

-- Every existing membership keeps exactly the role it had, now as a link.
INSERT INTO "membership_roles" ("membership_id", "role_id", "tenant_id", "user_id")
SELECT m.id, r.id, m.tenant_id, m.user_id
FROM "tenant_memberships" m
JOIN "roles" r ON r.tenant_id = m.tenant_id AND r.key = m.role
ON CONFLICT ("membership_id", "role_id") DO NOTHING;
