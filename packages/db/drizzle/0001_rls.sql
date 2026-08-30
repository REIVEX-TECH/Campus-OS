-- Row-Level Security: the tenant isolation boundary (CLAUDE.md §4).
-- FORCE applies RLS even to the table owner (campusos_app). A superuser still
-- bypasses RLS, which is exactly why the app must never connect as one.
-- current_setting('app.tenant_id', true) returns NULL when unset, so with no
-- tenant context selected the policy matches nothing (default deny).

ALTER TABLE "campuses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "campuses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campuses"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "buildings"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rooms"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
