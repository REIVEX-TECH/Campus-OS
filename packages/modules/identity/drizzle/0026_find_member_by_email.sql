-- Find a member of THIS tenant by their email, so an administrator can grant the
-- first admin (or any member) a role by the address they know, not the CampusOS
-- handle they may not. Emails are private: the users table is self-only under RLS
-- (0001 own_user), so this read is an owner-run definer, gated on the caller's
-- authority.
--
-- Authorization is one test: the caller must hold manage-roles in this tenant,
-- resolved through auth_effective_permissions -- from membership for a resident
-- admin, and from the grant for a platform admin under an open grant for this
-- tenant (its branch re-checks the actor is still a platform_admin with a live
-- grant, and yields nothing for another tenant). So the decision keys on the
-- unforgeable grant use-row, never a bare GUC (CLAUDE.md 8), the same shape as
-- auth_set_join_policy.
--
-- Privacy: it resolves an email ONLY to a member of this tenant. A person with an
-- account but no membership here, and a person with no account at all, both
-- return nothing -- so a tenant admin cannot enumerate accounts across tenants,
-- and the next step is the same either way (have them sign in to this university
-- once). It returns the handle (public) and role keys the admin needs, never the
-- email or any other PII.
CREATE OR REPLACE FUNCTION auth_find_member_by_email(p_tenant_id text, p_email text)
	RETURNS TABLE (user_id uuid, handle text, is_verified boolean, roles text[])
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'manage-roles'
	) THEN
		RETURN; -- not authorized: empty, no leak (the route already 404s such callers)
	END IF;

	RETURN QUERY
		SELECT u.id,
		       u.handle,
		       (m.verified_at IS NOT NULL AND m.status = 'active') AS is_verified,
		       coalesce(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
		FROM users u
		JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = p_tenant_id
		LEFT JOIN membership_roles mr ON mr.membership_id = m.id
		LEFT JOIN roles r ON r.id = mr.role_id
		WHERE lower(u.email) = lower(btrim(p_email))
		GROUP BY u.id, u.handle, m.verified_at, m.status;
END;
$$;
--> statement-breakpoint
-- App-callable: the roles UI invokes it under the manage-roles context (a resident
-- admin, or a platform admin under a grant) and it does its own check inside.
REVOKE ALL ON FUNCTION auth_find_member_by_email(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_find_member_by_email(text, text) TO campusos_app';
	END IF;
END
$$;
