-- Role definitions become platform administration.
--
-- Deciding which roles exist and what each one carries is not the same power as
-- deciding who holds one here. Until now `manage-roles` carried both, which let
-- a tenant administrator create a role holding `communities.unmask`, a
-- permission the catalogue gives to nobody, and grant it to themselves. The
-- definitions move to the platform: `role_templates` has no `tenant_id` because
-- a definition is not a tenant's to own.
--
-- A tenant's own `roles` and `role_permissions` rows stay exactly where they
-- are and become materialisations of the templates, so every permission check
-- keeps reading the same tables through the same definer function and the hot
-- path does not change at all.
CREATE TABLE IF NOT EXISTS "role_templates" (
	"key" text PRIMARY KEY,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_template_permissions" (
	"template_key" text NOT NULL REFERENCES "role_templates"("key") ON DELETE CASCADE,
	"permission" text NOT NULL,
	PRIMARY KEY ("template_key", "permission")
);
--> statement-breakpoint

-- Readable by anyone: a tenant administrator sees the definitions in order to
-- assign them, and there is nothing private in "the moderator role may remove
-- posts". Written only by a platform administrator, by the same policy shape as
-- tenant_configs: the subquery runs as the application role under the actor's
-- own context, and platform_roles shows a person exactly their own row.
--
-- RLS without FORCE on purpose: auth_sync_tenant_roles below reads these two.
ALTER TABLE "role_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_template_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "role_templates_read" ON "role_templates" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "role_template_permissions_read" ON "role_template_permissions" FOR SELECT USING (true);
--> statement-breakpoint
DO $$
DECLARE
	t text;
	c text;
BEGIN
	FOREACH t IN ARRAY ARRAY['role_templates', 'role_template_permissions'] LOOP
		FOREACH c IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
			EXECUTE format(
				'CREATE POLICY %I ON %I AS PERMISSIVE FOR %s %s (EXISTS (
					SELECT 1 FROM platform_roles pr
					WHERE pr.user_id::text = current_setting(''app.user_id'', true)
					  AND pr.role = ''platform_admin''))',
				t || '_platform_' || lower(c), t, c,
				CASE WHEN c = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END
			);
		END LOOP;
	END LOOP;
END
$$;
--> statement-breakpoint
-- UPDATE needs the check on the new row as well as the old one.
CREATE POLICY "role_templates_platform_update_check" ON "role_templates" AS RESTRICTIVE FOR UPDATE
	WITH CHECK (EXISTS (
		SELECT 1 FROM "platform_roles" pr
		WHERE pr."user_id"::text = current_setting('app.user_id', true)
		  AND pr."role" = 'platform_admin'
	));
--> statement-breakpoint

-- The tenant's own role rows stop being writable from a tenant context. Reads
-- are unchanged, so listRoles and auth_effective_permissions keep working; the
-- writes that remain are a platform administrator's, and the definer function
-- below, which is what the actorless seeding paths call.
DROP POLICY IF EXISTS "roles_in_tenant" ON "roles";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_permissions_in_tenant" ON "role_permissions";
--> statement-breakpoint
CREATE POLICY "roles_read_in_tenant" ON "roles" FOR SELECT
	USING ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "role_permissions_read_in_tenant" ON "role_permissions" FOR SELECT
	USING ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
DO $$
DECLARE
	t text;
	c text;
BEGIN
	FOREACH t IN ARRAY ARRAY['roles', 'role_permissions'] LOOP
		FOREACH c IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
			EXECUTE format(
				'CREATE POLICY %I ON %I AS PERMISSIVE FOR %s %s (
					"tenant_id" = current_setting(''app.tenant_id'', true)
					AND EXISTS (
						SELECT 1 FROM platform_roles pr
						WHERE pr.user_id::text = current_setting(''app.user_id'', true)
						  AND pr.role = ''platform_admin''))',
				t || '_platform_' || lower(c), t, c,
				CASE WHEN c = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END
			);
		END LOOP;
	END LOOP;
END
$$;
--> statement-breakpoint

-- The six definitions every tenant starts with, mirroring SYSTEM_ROLES and
-- COMMUNITY_ROLES in core. They are seeded here rather than by application code
-- because seeding them is a privilege change, and a privilege change should be a
-- migration somebody reviewed. `tenant_admin` carries every permission in the
-- catalogue except `communities.unmask`, which is never a default.
INSERT INTO "role_templates" ("key", "name", "is_system") VALUES
	('student', 'Student', true),
	('teacher', 'Teacher', true),
	('tenant_admin', 'Administrator', true),
	('community_member', 'Member', true),
	('community_moderator', 'Moderator', true),
	('community_owner', 'Owner', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_key", "permission")
SELECT t.key, p.permission FROM (VALUES
	('student', 'post'),
	('student', 'communities.create'),
	('teacher', 'post'),
	('teacher', 'communities.create'),
	('community_member', 'communities.post'),
	('community_member', 'communities.comment'),
	('community_member', 'communities.vote'),
	('community_moderator', 'communities.post'),
	('community_moderator', 'communities.comment'),
	('community_moderator', 'communities.vote'),
	('community_moderator', 'communities.moderate'),
	('community_moderator', 'communities.flairs'),
	('community_owner', 'communities.post'),
	('community_owner', 'communities.comment'),
	('community_owner', 'communities.vote'),
	('community_owner', 'communities.moderate'),
	('community_owner', 'communities.flairs'),
	('community_owner', 'communities.manage'),
	('community_owner', 'communities.transfer')
) AS p(key, permission)
JOIN "role_templates" t ON t.key = p.key
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_key", "permission")
SELECT 'tenant_admin', p.permission FROM (VALUES
	('manage-timetable'), ('manage-rooms'), ('approve-verifications'), ('manage-members'),
	('manage-roles'), ('view-analytics'), ('post'), ('moderate'),
	('communities.create'), ('communities.oversee'),
	('communities.post'), ('communities.comment'), ('communities.vote'),
	('communities.moderate'), ('communities.flairs'), ('communities.manage'),
	('communities.transfer')
) AS p(permission)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Materialise the templates into one tenant's roles.
--
-- SECURITY DEFINER because the paths that call it are actorless and ordinary:
-- a sign in that creates a membership, a tenant load, the first community in a
-- tenant. None of them has a platform administrator to hand, and none of them
-- should need one. The function writes only `is_system` rows whose key names a
-- template, so it cannot be used to mint a role of a tenant's own, and it
-- reconciles permissions to exactly the template's set so a tenant's copy
-- cannot drift from the definition.
CREATE OR REPLACE FUNCTION auth_sync_tenant_roles(p_tenant_id text)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_template record;
	v_role_id uuid;
	v_touched integer := 0;
BEGIN
	IF p_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM universities u WHERE u.slug = p_tenant_id) THEN
		RETURN 0;
	END IF;
	FOR v_template IN SELECT key, name FROM role_templates LOOP
		INSERT INTO roles (tenant_id, key, name, is_system)
		VALUES (p_tenant_id, v_template.key, v_template.name, true)
		ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name;

		SELECT id INTO v_role_id FROM roles
		WHERE tenant_id = p_tenant_id AND key = v_template.key;

		INSERT INTO role_permissions (role_id, tenant_id, permission)
		SELECT v_role_id, p_tenant_id, tp.permission
		FROM role_template_permissions tp
		WHERE tp.template_key = v_template.key
		ON CONFLICT (role_id, permission) DO NOTHING;

		DELETE FROM role_permissions rp
		WHERE rp.role_id = v_role_id
		  AND NOT EXISTS (
			SELECT 1 FROM role_template_permissions tp
			WHERE tp.template_key = v_template.key AND tp.permission = rp.permission);

		v_touched := v_touched + 1;
	END LOOP;
	RETURN v_touched;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_sync_tenant_roles(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON role_templates, role_template_permissions TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_sync_tenant_roles(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Every tenant that already exists takes the definitions now, so the roles it
-- has and the definitions it will be shown agree from this moment.
DO $$
DECLARE
	v_slug text;
BEGIN
	FOR v_slug IN SELECT slug FROM universities LOOP
		PERFORM auth_sync_tenant_roles(v_slug);
	END LOOP;
END
$$;
