-- Who may write tenant configuration: a platform administrator, and nobody
-- else the application can act as.
--
-- tenant_configs belongs to the base schema and is readable everywhere (db
-- 0004). Its write policies live here because they reference platform_roles,
-- which this module owns. The subquery runs as the application role under the
-- actor's own context, and platform_roles shows a person exactly their own row,
-- so the policy holds when the actor IS a platform admin and matches nothing
-- otherwise. No definer function, no FORCE change: platform_roles keeps FORCE.
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
