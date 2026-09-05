-- One-time, owner-run migration of config-seeded tenant admins into real
-- membership rows, so `adminEmails` self-seeding can then be retired (the 0016
-- residual: a tenant's admin list moved into DB-editable config, which re-seeds
-- tenant_admin at sign-in). This converts every current effective adminEmails
-- admin who already has an account into a `tenant_admin` membership, audited with
-- a DISTINCT action so the provenance is legible, BEFORE the ensureConfiguredAdmin
-- code path is deleted. An address with no account yet returns 'no_user': that
-- person signs in once and is granted through the roles UI (the bootstrap path),
-- which is the only remaining way in after retirement.
--
-- OWNER-ONLY. It seeds tenant_admin for an arbitrary email, so the application
-- role must never call it; it is invoked by scripts/migrate-configured-admins.ts
-- over the owner connection. Idempotent: re-running upgrades nothing already an
-- admin and re-audits nothing.
CREATE OR REPLACE FUNCTION auth_migrate_configured_admin(p_tenant_id text, p_email text)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_uid uuid;
	v_id uuid;
	v_created boolean := false;
	v_had_role boolean;
BEGIN
	SELECT id INTO v_uid FROM users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
	IF v_uid IS NULL THEN
		RETURN 'no_user';
	END IF;
	PERFORM auth_sync_tenant_roles(p_tenant_id);
	INSERT INTO tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
	VALUES (p_tenant_id, v_uid, 'tenant_admin', 'active', now(), 'config')
	ON CONFLICT (tenant_id, user_id) DO NOTHING
	RETURNING id INTO v_id;
	IF v_id IS NOT NULL THEN
		v_created := true;
	ELSE
		SELECT id INTO v_id FROM tenant_memberships WHERE tenant_id = p_tenant_id AND user_id = v_uid;
		UPDATE tenant_memberships
		   SET role = 'tenant_admin',
		       verified_at = coalesce(verified_at, now()),
		       verification_method = coalesce(verification_method, 'config')
		 WHERE id = v_id;
	END IF;
	SELECT EXISTS (
		SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
		WHERE mr.membership_id = v_id AND r.key = 'tenant_admin'
	) INTO v_had_role;
	PERFORM auth_attach_role_internal(v_id, p_tenant_id, v_uid, 'tenant_admin');
	IF v_created OR NOT v_had_role THEN
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_uid, p_tenant_id, 'membership.migrated_from_config', 'membership', v_id::text,
		        jsonb_build_object('role', 'tenant_admin', 'source', 'config_migration'));
		RETURN CASE WHEN v_created THEN 'migrated' ELSE 'upgraded' END;
	END IF;
	RETURN 'already';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_migrate_configured_admin(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	-- Split database only, and only when the app is not the owner: on an unsplit
	-- development database the app owns the function and the guarantee cannot hold
	-- there anyway.
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND (
	     SELECT pg_get_userbyid(p.proowner) <> 'campusos_app'
	     FROM pg_proc p
	     WHERE p.proname = 'auth_migrate_configured_admin'
	       AND p.pronamespace = 'public'::regnamespace
	     LIMIT 1
	   )
	THEN
		EXECUTE 'REVOKE ALL ON FUNCTION auth_migrate_configured_admin(text, text) FROM campusos_app';
	END IF;
END
$$;
