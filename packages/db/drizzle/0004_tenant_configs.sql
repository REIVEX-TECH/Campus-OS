-- Tenant configuration, database backed.
--
-- Until now a tenant's configuration was a file compiled into the app, so
-- adding a university was a deploy. The database becomes the source of truth
-- and the files stay as the fallback: per slug a valid row wins, a missing row
-- falls back to the file, an invalid row is skipped and reported. The config is
-- the same validated shape as the file (tenantConfigSchema in core), stored
-- whole; the columns on universities that other tables and RLS key on are kept
-- in step by the code that writes here.
--
-- Readable by anyone: this is what renders a tenant's public pages. Written only
-- by a platform administrator. That policy references platform_roles, which the
-- identity module owns, so it arrives with that module's migrations (0012);
-- until then the application role cannot write here at all. No FORCE: the
-- schema owner writes rows in the sync script, and the application owns nothing.
CREATE TABLE "tenant_configs" (
	"slug" text PRIMARY KEY REFERENCES "universities"("slug") ON DELETE CASCADE,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "tenant_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_configs_read" ON "tenant_configs" FOR SELECT USING (true);
