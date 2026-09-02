-- RLS for the identity tables.
--
-- The rest of the schema is tenant scoped and keyed by app.tenant_id. These
-- tables mostly are not: a person exists above any one university. So a second
-- transaction local context, app.user_id, carries the authenticated user, and
-- the policies below key on it. As with tenants, current_setting(..., true)
-- returns NULL when unset, so no context means no rows: default deny.
--
-- FORCE applies the policy even to the table owner, matching 0001_rls.sql.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_user" ON "users"
	USING ("id"::text = current_setting('app.user_id', true))
	WITH CHECK ("id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_sessions" ON "sessions"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- Two legitimate reads: "which tenants am I in", before a tenant is chosen, and
-- "who is in this tenant", inside a tenant context.
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_or_tenant_memberships" ON "tenant_memberships"
	USING (
		"user_id"::text = current_setting('app.user_id', true)
		OR "tenant_id" = current_setting('app.tenant_id', true)
	)
	WITH CHECK (
		"user_id"::text = current_setting('app.user_id', true)
		OR "tenant_id" = current_setting('app.tenant_id', true)
	);
--> statement-breakpoint

ALTER TABLE "platform_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_platform_role" ON "platform_roles"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

ALTER TABLE "handle_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "handle_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_handle_history" ON "handle_history"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- The audit log is append only and readable within a tenant context, so a tenant
-- admin can see who entered their tenant and why.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_read_in_tenant" ON "audit_log" FOR SELECT
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		OR "actor_user_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint
CREATE POLICY "audit_append" ON "audit_log" FOR INSERT
	WITH CHECK (true);
--> statement-breakpoint

-- Belt and braces on append only: no UPDATE or DELETE policy exists, and this
-- trigger raises even if one were added by mistake later.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_change ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint

-- NOTE: session resolution (auth_resolve_session) is deliberately NOT here.
-- It cannot work while the application role is also the table owner:
-- SECURITY DEFINER would elevate to the same role, and FORCE ROW LEVEL SECURITY
-- applies the policy to the owner too, so the lookup finds nothing. Splitting
-- the migration owner from the application role fixes it, which is a deployment
-- decision. See docs/overnight/DECISIONS.md. Sign in needs this settled first.
