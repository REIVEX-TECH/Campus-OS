-- Only a platform administrator, acting under a live cross-tenant grant, may set
-- tenant roles. A resident tenant_admin manages members and everything else, but
-- no longer assigns or revokes roles.
--
-- Why: granting `tenant_admin` (or any role) is the sharpest self-perpetuating
-- power in a tenant -- a resident admin holding it can mint co-admins and entrench
-- themselves beyond the platform's reach. Role assignment is therefore lifted to
-- the platform operator, who acts only under an audited, time-boxed grant. The
-- write itself was already contained to a live grant use-row for the platform path
-- (0029); this removes the resident path entirely.
--
-- Mechanics:
--   1. Drop `manage-roles` from the tenant_admin TEMPLATE, then re-sync every
--      tenant. auth_sync_tenant_roles (0013) reconciles each tenant's materialized
--      role_permissions to EXACTLY the template set (it deletes perms no longer in
--      the template), so this strips `manage-roles` from every tenant_admin role.
--   2. Because the grant branch of auth_effective_permissions derives a visitor's
--      permissions from that same materialized tenant_admin role_permissions, the
--      strip in (1) would also take `manage-roles` away from a platform admin under
--      a grant -- who must keep it (the roles API gate, tenantWriteContext, checks
--      it). So the resolver is re-defined to add `manage-roles` back EXPLICITLY in
--      the grant branch, keyed on the same unforgeable txid use-row, and only there.
--   3. auth_set_membership_role (0029) is unchanged: a resident now fails its
--      `manage-roles` gate (returns not_allowed), and a platform admin under a grant
--      still passes via the v_from_platform exemption keyed on the grant use-row.

-- 1a. Remove the template row.
DELETE FROM "role_template_permissions"
WHERE "template_key" = 'tenant_admin' AND "permission" = 'manage-roles';
--> statement-breakpoint
-- 1b. Reconcile every tenant so no materialized tenant_admin role keeps it.
DO $$
DECLARE
	v_slug text;
BEGIN
	FOR v_slug IN SELECT slug FROM universities LOOP
		PERFORM auth_sync_tenant_roles(v_slug);
	END LOOP;
END
$$;
--> statement-breakpoint

-- 2. Re-define the resolver. Membership branch unchanged; grant branch unchanged
-- except it now also yields `manage-roles` for a platform admin under a live grant
-- (added explicitly because step 1 removed it from the tenant_admin role_permissions
-- the grant branch reads). communities.unmask stays excluded; view-member-identity
-- (0031) is NOT excluded and flows through the role_permissions branch as before.
CREATE OR REPLACE FUNCTION auth_effective_permissions(p_user_id uuid, p_tenant_id text)
	RETURNS TABLE (permission text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT DISTINCT rp.permission
	FROM membership_roles mr
	JOIN tenant_memberships m ON m.id = mr.membership_id
	JOIN role_permissions rp ON rp.role_id = mr.role_id
	WHERE mr.user_id = p_user_id
	  AND mr.tenant_id = p_tenant_id
	  AND (m.status = 'active' OR (m.standing_until IS NOT NULL AND m.standing_until <= now()))
	UNION
	SELECT DISTINCT rp.permission
	FROM platform_grant_uses u
	JOIN platform_tenant_grants g ON g.id = u.grant_id
	JOIN platform_roles pr ON pr.user_id = g.admin_user_id AND pr.role = 'platform_admin'
	JOIN sessions s ON s.id = g.session_id
	JOIN roles r ON r.tenant_id = g.tenant_id AND r.key = 'tenant_admin' AND r.is_system
	JOIN role_permissions rp ON rp.role_id = r.id
	WHERE u.txid = pg_current_xact_id_if_assigned()
	  AND g.admin_user_id = p_user_id
	  AND g.tenant_id = p_tenant_id
	  AND g.revoked_at IS NULL
	  AND g.expires_at > now()
	  AND s.revoked_at IS NULL
	  AND s.expires_at > now()
	  -- A visitor is narrower than the resident administrator by exactly this.
	  AND rp.permission <> 'communities.unmask'
	UNION
	-- Role assignment is platform-only now, so `manage-roles` is off the tenant_admin
	-- template and out of the branch above. Grant it back to a platform admin under a
	-- live grant, keyed on the same unforgeable txid use-row, and to no one else.
	SELECT 'manage-roles'
	FROM platform_grant_uses u
	JOIN platform_tenant_grants g ON g.id = u.grant_id
	JOIN platform_roles pr ON pr.user_id = g.admin_user_id AND pr.role = 'platform_admin'
	JOIN sessions s ON s.id = g.session_id
	WHERE u.txid = pg_current_xact_id_if_assigned()
	  AND g.admin_user_id = p_user_id
	  AND g.tenant_id = p_tenant_id
	  AND g.revoked_at IS NULL
	  AND g.expires_at > now()
	  AND s.revoked_at IS NULL
	  AND s.expires_at > now();
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_effective_permissions(uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_effective_permissions(uuid, text) TO campusos_app';
	END IF;
END
$$;
