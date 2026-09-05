-- auth_write_standing's "not yourself" check keyed on app.user_id, a GUC the
-- application sets and can re-set mid-transaction. That is the exact shape
-- CLAUDE.md forbids: an authorization decision keyed on an app-writable value is
-- not an authorization decision. Its siblings auth_set_membership_role and
-- auth_verify_member refuse targeting the grant admin read from the unforgeable
-- txid-stamped use-row (auth_grant_admin_for_txn); standing must do the same.
--
-- Not exploitable today (standing only UPDATEs an existing membership and a
-- platform admin acting under a grant holds none in the tenant, so a self-target
-- returns not_found), but the rule holds regardless of current exploitability:
-- under a grant, "yourself" is the grant admin on the use-row, not whoever
-- app.user_id currently claims. The member path keeps its app.user_id self-check
-- (there is no use-row, and a member's own id is not forgeable by RLS anyway).
--
-- CREATE OR REPLACE preserves the function's EXECUTE grant to campusos_app (0019);
-- no schema change, only the body.
CREATE OR REPLACE FUNCTION auth_write_standing(
	p_tenant_id text, p_target uuid, p_status text, p_reason text, p_until timestamptz
)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_grant_admin uuid := auth_grant_admin_for_txn();
	v_id uuid;
	v_admins integer;
	v_target_is_admin boolean;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	-- Under a grant, "yourself" is the grant admin on the unforgeable use-row.
	IF v_grant_admin IS NOT NULL AND p_target = v_grant_admin THEN
		RETURN 'self';
	END IF;
	-- Member path: no use-row, so the actor is app.user_id (their own membership).
	IF v_grant_admin IS NULL AND p_target = v_user THEN
		RETURN 'self';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p WHERE p.permission = 'restrict-members'
	) THEN
		RETURN 'not_allowed';
	END IF;
	SELECT id INTO v_id FROM tenant_memberships WHERE tenant_id = p_tenant_id AND user_id = p_target;
	IF v_id IS NULL THEN
		RETURN 'not_found';
	END IF;
	-- Never lock out the last active administrator.
	IF p_status <> 'active' THEN
		SELECT count(*)::int INTO v_admins FROM tenant_memberships m
		JOIN membership_roles mr ON mr.membership_id = m.id
		JOIN roles r ON r.id = mr.role_id
		WHERE m.tenant_id = p_tenant_id AND m.status = 'active' AND r.key = 'tenant_admin';
		SELECT EXISTS (
			SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
			WHERE mr.tenant_id = p_tenant_id AND mr.user_id = p_target AND r.key = 'tenant_admin'
		) INTO v_target_is_admin;
		IF v_admins <= 1 AND v_target_is_admin THEN
			RETURN 'last_admin';
		END IF;
	END IF;
	UPDATE tenant_memberships
	   SET status = p_status,
	       standing_reason = CASE WHEN p_status = 'active' THEN NULL ELSE p_reason END,
	       standing_until = CASE WHEN p_status = 'active' THEN NULL ELSE p_until END,
	       standing_by = v_user,
	       standing_at = now(),
	       appeal_note = NULL,
	       appeal_at = NULL
	 WHERE id = v_id;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id,
	        CASE WHEN p_status = 'suspended' THEN 'member.suspended'
	             WHEN p_status = 'restricted' THEN 'member.restricted'
	             ELSE 'member.reinstated' END,
	        'membership', v_id::text,
	        jsonb_build_object('targetUserId', p_target::text, 'reason', p_reason,
	                           'until', CASE WHEN p_until IS NULL THEN NULL ELSE p_until::text END));
	RETURN 'ok';
END;
$$;
