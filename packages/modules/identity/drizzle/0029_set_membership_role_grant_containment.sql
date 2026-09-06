-- Contain the platform-admin exemption in auth_set_membership_role to a live grant.
--
-- auth_set_membership_role is the one writer of membership_roles from the
-- application side. It carries a deliberate exemption: a platform admin may grant
-- a role carrying `communities.unmask` (and, more generally, act with tenant_admin
-- reach), because no resident holds `communities.unmask` -- without this exemption
-- that permission could never be assigned to anyone. That exemption is correct;
-- what was wrong is that it rested on a bare read of `platform_roles` keyed on
-- `app.user_id`, with NO requirement that a grant use-row exist for this
-- transaction. Two consequences, both off-grant:
--
--   1. The self-target refusal fired only `IF v_grant_admin IS NOT NULL`, so a
--      platform-admin context could auth_join_as_student(victim) and then
--      auth_set_membership_role(victim, self, 'tenant_admin', true) to
--      self-escalate to a real tenant_admin membership of any tenant -- off-grant,
--      un-attributable to any grant (NULL grant id in the audit row).
--   2. The exemption bypassed manage-roles and above_own for ANY platform admin,
--      so the same context could install any role (including a
--      communities.unmask-bearing one) on any member, off-grant.
--
-- This is the exact pattern CLAUDE.md 8 forbids: a privilege decision keyed on a
-- value the application writes (`app.user_id`, `platform_roles` read directly),
-- and it violated the resolver's own codified invariant -- "a platform admin with
-- no use row for this transaction resolves to nothing" (0018). Every sibling
-- privileged-write definer already routes platform power through the unforgeable
-- grant use-row; this one did not.
--
-- The fix keys the exemption on the grant use-row, exactly like its siblings:
-- v_from_platform is true ONLY when a grant is live for this transaction AND the
-- unforgeable grant admin (auth_grant_admin_for_txn(), read from the use-row, not
-- app.user_id) is a platform admin. Off-grant, v_grant_admin is NULL, the
-- exemption is unreachable, and a platform admin resolves to nothing in a tenant
-- they do not reside in -- self-escalation and off-grant role installation are
-- both closed. Under a grant the self-target refusal already applied, so unmask
-- assignment survives, now scoped to an audited, expiring, single-tenant grant.
--
-- No production flow changes: the web write context (tenantWriteContext) already
-- refuses a platform admin without a live grant before this definer is reached, so
-- the app never called this path off-grant. This migration makes the database
-- enforce what the application already enforced, so the app is no longer the sole
-- guard.
CREATE OR REPLACE FUNCTION auth_set_membership_role(
	p_tenant_id text, p_target uuid, p_role_key text, p_grant boolean
)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_from_platform boolean;
	v_role_id uuid;
	v_membership_id uuid;
	v_grant_admin uuid := auth_grant_admin_for_txn();
	v_holders integer;
	v_deleted integer;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	-- Under a grant, never a role for the visitor themselves.
	IF v_grant_admin IS NOT NULL AND p_target = v_grant_admin THEN
		RETURN 'not_allowed';
	END IF;
	-- The platform exemption is reachable ONLY under a live grant, and is decided
	-- on the unforgeable grant admin (from the use row), never on app.user_id.
	-- Off-grant, v_grant_admin is NULL, so a platform admin has no exemption here
	-- and must resolve manage-roles as a resident like anyone else.
	v_from_platform := v_grant_admin IS NOT NULL AND EXISTS (
		SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_grant_admin AND pr.role = 'platform_admin'
	);
	IF NOT v_from_platform AND NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p WHERE p.permission = 'manage-roles'
	) THEN
		RETURN 'not_allowed';
	END IF;
	SELECT id INTO v_role_id FROM roles WHERE tenant_id = p_tenant_id AND key = p_role_key;
	IF v_role_id IS NULL THEN
		RETURN 'no_such_role';
	END IF;

	IF p_grant THEN
		-- Nobody grants a power they do not have (platform admin under a grant
		-- excepted -- the only way communities.unmask is ever assigned).
		IF NOT v_from_platform AND EXISTS (
			SELECT rp.permission FROM role_permissions rp WHERE rp.role_id = v_role_id
			EXCEPT
			SELECT p.permission FROM auth_effective_permissions(v_user, p_tenant_id) p
		) THEN
			RETURN 'above_own';
		END IF;
		SELECT id INTO v_membership_id FROM tenant_memberships
		WHERE tenant_id = p_tenant_id AND user_id = p_target;
		IF v_membership_id IS NULL THEN
			RETURN 'no_such_member';
		END IF;
		INSERT INTO membership_roles (membership_id, role_id, tenant_id, user_id, granted_by)
		VALUES (v_membership_id, v_role_id, p_tenant_id, p_target, v_user)
		ON CONFLICT (membership_id, role_id) DO NOTHING;
		GET DIAGNOSTICS v_deleted = ROW_COUNT; -- reused as a rows-affected counter
		IF v_deleted = 0 THEN
			RETURN 'unchanged';
		END IF;
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_user, p_tenant_id, 'role.granted', 'membership', v_membership_id::text,
		        jsonb_build_object('role', p_role_key, 'targetUserId', p_target::text,
		                           'viaPlatform', v_from_platform));
		RETURN 'changed';
	ELSE
		-- A tenant must keep at least one administrator.
		IF p_role_key = 'tenant_admin' THEN
			SELECT count(*)::int INTO v_holders FROM membership_roles
			WHERE tenant_id = p_tenant_id AND role_id = v_role_id;
			IF v_holders <= 1 THEN
				RETURN 'last_admin';
			END IF;
		END IF;
		-- (membership_id, role_id) is the PK, and a member has one membership per
		-- tenant, so this deletes at most one row: RETURNING ... INTO is safe.
		DELETE FROM membership_roles
		WHERE tenant_id = p_tenant_id AND user_id = p_target AND role_id = v_role_id
		RETURNING membership_id INTO v_membership_id;
		GET DIAGNOSTICS v_deleted = ROW_COUNT;
		IF v_deleted = 0 THEN
			RETURN 'unchanged';
		END IF;
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_user, p_tenant_id, 'role.revoked', 'membership', v_membership_id::text,
		        jsonb_build_object('role', p_role_key, 'targetUserId', p_target::text));
		RETURN 'changed';
	END IF;
END;
$$;
