-- A tenant's auto-join policy (joinMode + allowedEmailDomains) leaves the general
-- config editor and moves behind a definer, so changing WHO may auto-join a
-- tenant is a deliberate, audited, contained act rather than a field on a form.
--
-- These two keys still live in tenant_configs.config (so sign-in consumption,
-- ensureDomainMembership -> auth_verify_self_by_domain, is unchanged), but the
-- application's own UPDATE of tenant_configs is blocked under a grant (0018
-- tenant_configs_not_under_grant), and the general platform editor no longer
-- writes them at all. This definer is the one sanctioned writer. tenant_configs
-- has RLS without FORCE (0012), so the owner-run definer bypasses the policies
-- and enforces authorization itself.
--
-- Who may write:
--  * a platform admin ONLY through an OPEN GRANT for THIS tenant -- read from the
--    unforgeable use-row for the current txid (never app.user_id, CLAUDE.md 8);
--  * otherwise a tenant member with `manage-members`.
-- It governs member auto-join, never admin: the worst a wrong value does is admit
-- students, and even that is guarded below.
--
-- Structural guard: a well-known consumer email provider in allowedEmailDomains
-- would auto-verify "the whole internet" as students. That must not be reachable
-- by mistake or by a direct call, so the definer refuses a curated blocklist of
-- consumer domains. Open membership, if ever wanted, must be a deliberate joinMode
-- value, never a side effect of a domain entry.
--
-- Returns a small text code: 'ok', 'not_allowed', 'no_tenant', 'invalid_mode',
-- or 'blocked_domain:<domain>'.
CREATE OR REPLACE FUNCTION auth_set_join_policy(
	p_tenant_id text, p_join_mode text, p_allowed_domains text[]
)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_actor uuid;
	v_under_grant boolean;
	v_domains text[];
	v_domain text;
	-- Curated blocklist of common consumer email providers. Not exhaustive: its job
	-- is to make the obvious "everyone auto-joins" mistake unreachable, not to be a
	-- complete allowlist. Extend by replacing this function in a later migration.
	v_consumer text[] := ARRAY[
		'gmail.com', 'googlemail.com',
		'outlook.com', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
		'live.com', 'live.co.uk', 'msn.com',
		'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de', 'ymail.com', 'rocketmail.com',
		'icloud.com', 'me.com', 'mac.com',
		'proton.me', 'protonmail.com', 'pm.me',
		'aol.com', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'mail.ru',
		'zoho.com', 'yandex.com', 'yandex.ru',
		'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net',
		'hey.com', 'fastmail.com', 'tutanota.com', 'tuta.io', 'tuta.com'
	];
BEGIN
	-- Authorization is the same test for both callers: the actor must hold
	-- manage-members in this tenant. auth_effective_permissions resolves that from
	-- membership for a resident admin and, for a platform admin under an open grant
	-- FOR THIS TENANT, from the grant -- whose branch re-checks the actor is STILL a
	-- platform_admin with a live grant, and yields nothing for another tenant. So a
	-- de-admined holder of a still-open grant, and a grant for a different tenant,
	-- are both refused here exactly as every sibling definer refuses them, and the
	-- decision keys on that unforgeable resolution (the grant use-row), never on a
	-- bare GUC (CLAUDE.md 8). The use-row is consulted only to label the audit.
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'manage-members'
	) THEN
		RETURN 'not_allowed';
	END IF;
	v_actor := v_user;
	v_under_grant := auth_grant_admin_for_txn() IS NOT NULL;

	IF p_join_mode NOT IN ('domain', 'invite') THEN
		RETURN 'invalid_mode';
	END IF;

	-- Normalise (lower, trim, drop blanks), then refuse any consumer provider.
	v_domains := ARRAY(
		SELECT lower(btrim(d)) FROM unnest(coalesce(p_allowed_domains, '{}')) d
		WHERE btrim(d) <> ''
	);
	FOREACH v_domain IN ARRAY v_domains LOOP
		IF v_domain = ANY (v_consumer) THEN
			RETURN 'blocked_domain:' || v_domain;
		END IF;
	END LOOP;

	-- Write only the two keys; other config is untouched. The tenant must have a
	-- config row (created with the university).
	UPDATE tenant_configs
	   SET config = jsonb_set(
	                  jsonb_set(config, '{joinMode}', to_jsonb(p_join_mode), true),
	                  '{allowedEmailDomains}', to_jsonb(v_domains), true),
	       version = version + 1,
	       updated_at = now(),
	       updated_by = v_actor
	 WHERE slug = p_tenant_id;
	IF NOT FOUND THEN
		RETURN 'no_tenant';
	END IF;

	-- One audit line, grant-stamped by audit_log_stamp_grant when under a grant.
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_actor, p_tenant_id, 'tenant.join_policy_updated', 'tenant', p_tenant_id,
	        jsonb_build_object('joinMode', p_join_mode, 'allowedEmailDomains', to_jsonb(v_domains),
	                           'via', CASE WHEN v_under_grant THEN 'grant' ELSE 'member' END));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint
-- App-callable: the application invokes it (under a grant for a platform admin,
-- or as a tenant member with manage-members) and it does its own checks inside.
REVOKE ALL ON FUNCTION auth_set_join_policy(text, text, text[]) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_set_join_policy(text, text, text[]) TO campusos_app';
	END IF;
END
$$;
