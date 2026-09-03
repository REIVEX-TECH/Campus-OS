-- Tenant configuration, database backed. Owned by this module because platform
-- administration is: who may write here is a platform_roles question.
--
-- Until now a tenant's configuration was a file compiled into the app, so
-- adding a university was a deploy. The database becomes the source of truth
-- and the files stay as the fallback: per slug a valid row wins, a missing row
-- falls back to the file, an invalid row is skipped and reported. The config is
-- the same validated shape as the file (tenantConfigSchema in core), stored
-- whole; the columns on universities that other tables and RLS key on are kept
-- in step by the code that writes here.
--
-- Why not a base (@campusos/db) migration: the base folder and the timetable
-- module share drizzle's default bookkeeping table, so a new base migration
-- cannot be dated to apply on both a fresh database (before timetable's entries)
-- and an existing one (after them). The base folder stays frozen; this module
-- has its own table and can grow.
CREATE TABLE IF NOT EXISTS "tenant_configs" (
	"slug" text PRIMARY KEY REFERENCES "universities"("slug") ON DELETE CASCADE,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "tenant_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Readable by anyone: this is what renders a tenant's public pages. No FORCE:
-- the schema owner writes rows in the sync script, and the application owns
-- nothing, so RLS binds it either way.
CREATE POLICY "tenant_configs_read" ON "tenant_configs" FOR SELECT USING (true);
--> statement-breakpoint

-- Written only by a platform administrator. The subquery runs as the
-- application role under the actor's own context, and platform_roles shows a
-- person exactly their own row, so the policy holds when the actor IS a
-- platform admin and matches nothing otherwise. No definer function, no FORCE
-- change: platform_roles keeps FORCE.
CREATE POLICY "tenant_configs_platform_admin_insert" ON "tenant_configs"
	FOR INSERT
	WITH CHECK (EXISTS (
		SELECT 1 FROM "platform_roles" pr
		WHERE pr."user_id"::text = current_setting('app.user_id', true)
		  AND pr."role" = 'platform_admin'
	));
--> statement-breakpoint
CREATE POLICY "tenant_configs_platform_admin_update" ON "tenant_configs"
	FOR UPDATE
	USING (EXISTS (
		SELECT 1 FROM "platform_roles" pr
		WHERE pr."user_id"::text = current_setting('app.user_id', true)
		  AND pr."role" = 'platform_admin'
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "platform_roles" pr
		WHERE pr."user_id"::text = current_setting('app.user_id', true)
		  AND pr."role" = 'platform_admin'
	));
