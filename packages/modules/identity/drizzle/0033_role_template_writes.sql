-- Security backlog M3: role definition writes leave the application role's hands.
--
-- role_templates and role_template_permissions were writable under PERMISSIVE
-- policies that check `EXISTS (platform_roles WHERE user_id = app.user_id)` -- a
-- PRIVILEGE decision keyed on a GUC the application sets and can re-set
-- mid-transaction (CLAUDE.md 8). Anything that could set app.user_id to a platform
-- admin's id could then rewrite what every role carries in every tenant.
--
-- This closes it the 0016/0019 way, with a finance-style stamp for the platform
-- host: a definer verifies the caller is a platform admin AND stamps the current
-- transaction id in `platform_admin_uses` (a table the app cannot read or write);
-- the write definers below then key on "is there a stamp for THIS transaction",
-- a row the caller cannot see, forge, or carry into another transaction. The GUC
-- keyed write policies are dropped, so a raw application write matches no policy and
-- fails. Reads are unchanged (definitions are public). A visitor under a tenant
-- grant is refused: editing the global catalogue is a platform-host act, not a
-- tenant one.

CREATE TABLE "platform_admin_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"txid" xid8 NOT NULL,
	"at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "platform_admin_uses_txid_idx" ON "platform_admin_uses" ("txid");
--> statement-breakpoint
ALTER TABLE "platform_admin_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No policy: the app reaches it only through the definers below. In a split
-- database revoke every app right by name (the 0018 discipline).
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname = 'platform_admin_uses' AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns platform_admin_uses: lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE ALL ON TABLE "platform_admin_uses" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Begin a platform-admin transaction. Verifies the caller is a platform admin
-- (platform_roles, which the app cannot write, 0016) and is NOT acting under a
-- tenant grant, then stamps the current txid. Its effect is the stamp; the
-- platform_roles read is the same trust the whole session rests on, and the stamp
-- is what the later checks key on, unforgeably per transaction.
CREATE OR REPLACE FUNCTION auth_begin_platform_admin()
	RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF auth_under_tenant_grant() THEN
		RAISE EXCEPTION 'a tenant-grant visitor may not act as a platform admin'
			USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_user AND pr.role = 'platform_admin'
	) THEN
		RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
	END IF;
	INSERT INTO platform_admin_uses (actor_user_id, txid) VALUES (v_user, pg_current_xact_id());
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_begin_platform_admin() FROM PUBLIC;
--> statement-breakpoint

-- The platform admin who authorized THIS transaction, or NULL. A definer, because
-- the app cannot read the uses table.
CREATE OR REPLACE FUNCTION auth_platform_admin_for_txn()
	RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
	SELECT u.actor_user_id FROM platform_admin_uses u
	WHERE u.txid = pg_current_xact_id_if_assigned()
	ORDER BY u.at DESC LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_platform_admin_for_txn() FROM PUBLIC;
--> statement-breakpoint

-- Drop the GUC-keyed write policies (0013) and the under-grant subtractions (0018):
-- the app no longer writes these tables directly at all.
DROP POLICY IF EXISTS "role_templates_platform_insert" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_platform_update" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_platform_delete" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_platform_update_check" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_not_under_grant" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_not_under_grant_u" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_templates_not_under_grant_d" ON "role_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_platform_insert" ON "role_template_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_platform_update" ON "role_template_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_platform_delete" ON "role_template_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_not_under_grant" ON "role_template_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_not_under_grant_u" ON "role_template_permissions";
--> statement-breakpoint
DROP POLICY IF EXISTS "role_template_permissions_not_under_grant_d" ON "role_template_permissions";
--> statement-breakpoint

-- With no write policy left, RLS default-denies an application write to either
-- table. But 0013 granted the app role table-level INSERT/UPDATE/DELETE, and a
-- bare grant outliving its policy is a loaded gun for a future permissive policy
-- (CLAUDE.md 8: writes are revoked from the app role BY NAME, not left to rest on
-- a policy that a later migration might re-add). So in a split database withdraw
-- those writes explicitly; reads (SELECT) stay, the definitions are public. In an
-- unsplit dev database the app owns the tables and this is skipped.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname IN ('role_templates', 'role_template_permissions')
		  AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns the role-template tables: write lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "role_templates" FROM campusos_app';
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "role_template_permissions" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Create a definition (template + its permissions), stamped platform admin only.
-- Returns true when a new row was written, false when the key already existed.
CREATE OR REPLACE FUNCTION auth_write_role_template(
	p_key text, p_name text, p_permissions text[]
)
	RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_platform_admin_for_txn();
	v_perm text;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'not an authorized platform-admin transaction' USING ERRCODE = '42501';
	END IF;
	INSERT INTO role_templates (key, name) VALUES (p_key, p_name)
	ON CONFLICT (key) DO NOTHING;
	-- ON CONFLICT DO NOTHING that skips affects no row, so FOUND is false: the key
	-- already existed (the same idiom 0016 uses for auth_grant_platform_admin).
	IF NOT FOUND THEN
		RETURN false;
	END IF;
	FOREACH v_perm IN ARRAY coalesce(p_permissions, ARRAY[]::text[]) LOOP
		INSERT INTO role_template_permissions (template_key, permission) VALUES (p_key, v_perm)
		ON CONFLICT DO NOTHING;
	END LOOP;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_admin, null, 'role_template.created', 'role_template', p_key,
	        jsonb_build_object('permissions', array_to_string(coalesce(p_permissions, ARRAY[]::text[]), ',')));
	RETURN true;
END; $$;
--> statement-breakpoint

-- Replace what a definition carries. Returns 'no_such_template' | 'unchanged' |
-- 'changed'. The caller re-syncs every tenant after a change.
CREATE OR REPLACE FUNCTION auth_set_role_template_permissions(
	p_key text, p_permissions text[]
)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_platform_admin_for_txn();
	v_wanted text[] := coalesce(p_permissions, ARRAY[]::text[]);
	v_added integer := 0;
	v_removed integer := 0;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'not an authorized platform-admin transaction' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM role_templates WHERE key = p_key) THEN
		RETURN 'no_such_template';
	END IF;
	WITH ins AS (
		INSERT INTO role_template_permissions (template_key, permission)
		SELECT p_key, w FROM unnest(v_wanted) w
		ON CONFLICT DO NOTHING
		RETURNING 1
	)
	SELECT count(*)::int INTO v_added FROM ins;
	WITH del AS (
		DELETE FROM role_template_permissions
		WHERE template_key = p_key AND permission <> ALL (v_wanted)
		RETURNING 1
	)
	SELECT count(*)::int INTO v_removed FROM del;
	IF v_added = 0 AND v_removed = 0 THEN
		RETURN 'unchanged';
	END IF;
	UPDATE role_templates SET updated_at = now() WHERE key = p_key;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_admin, null, 'role_template.changed', 'role_template', p_key,
	        jsonb_build_object('permissions', array_to_string(v_wanted, ',')));
	RETURN 'changed';
END; $$;
--> statement-breakpoint

-- Retire a definition. Returns 'no_such_template' | 'system_template' | 'deleted'.
CREATE OR REPLACE FUNCTION auth_delete_role_template(p_key text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_platform_admin_for_txn();
	v_is_system boolean;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'not an authorized platform-admin transaction' USING ERRCODE = '42501';
	END IF;
	SELECT is_system INTO v_is_system FROM role_templates WHERE key = p_key;
	IF v_is_system IS NULL THEN
		RETURN 'no_such_template';
	END IF;
	IF v_is_system THEN
		RETURN 'system_template';
	END IF;
	DELETE FROM role_templates WHERE key = p_key;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_admin, null, 'role_template.deleted', 'role_template', p_key, '{}'::jsonb);
	RETURN 'deleted';
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_write_role_template(text, text, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_set_role_template_permissions(text, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_delete_role_template(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_begin_platform_admin() TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_platform_admin_for_txn() TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_write_role_template(text, text, text[]) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_set_role_template_permissions(text, text[]) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_delete_role_template(text) TO campusos_app';
	END IF;
END
$$;
