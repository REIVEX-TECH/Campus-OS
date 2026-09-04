-- Membership and role writes leave the application role's hands.
--
-- `tenant_memberships` and `membership_roles` were writable by the application
-- under policies that check only `tenant_id = app.tenant_id` -- no check that
-- the writer may write a membership at all. So anything holding a tenant context
-- could insert itself a verified `tenant_admin` membership and the matching
-- `membership_roles` row, and `auth_effective_permissions` would then resolve it
-- as a real administrator. The TypeScript callers all checked authority first,
-- but the database did not enforce it, and "the only code path that does X is
-- careful" is the exact reasoning that left `platform_roles` open until 0016.
--
-- This closes it the way 0016 closed `platform_roles`: the application's direct
-- INSERT/UPDATE/DELETE on both tables is revoked, and every legitimate write
-- goes through a SECURITY DEFINER that checks the actor's authority and writes
-- the audit line itself. The definers run as the owner, so the 5A RESTRICTIVE
-- "no self under a grant" policies (which bound the app role) no longer apply to
-- them -- each definer therefore re-enforces the grant containment itself:
-- under a grant, a visitor may manage other members but never write their own
-- membership or role.
--
-- Where the database cannot know a fact the application holds -- a tenant's
-- allowed email domains, its configured admin list -- the caller passes it and
-- the definer checks the ACTOR's own email against it, exactly as
-- `auth_grant_platform_admin` does. That is the same trust boundary as before
-- (the TypeScript already read those lists from the tenant registry); what
-- changes is that a raw write with a forged context is no longer possible at all.

-- Lock the two tables against the application role in a split database. In an
-- unsplit development database the app owns them and this is skipped; the
-- guarantee holds only where the roles are split, which CI enforces.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname IN ('tenant_memberships', 'membership_roles')
		  AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns the membership tables: write lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "tenant_memberships" FROM campusos_app';
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "membership_roles" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- The 5A RESTRICTIVE subtraction policies on these two tables are now redundant:
-- the app cannot write them at all, so there is no permissive write for a
-- RESTRICTIVE policy to narrow, and the definers below enforce the grant
-- containment in code. Dropped to avoid two half-mechanisms for one rule.
DROP POLICY IF EXISTS "memberships_no_self_under_grant" ON "tenant_memberships";
--> statement-breakpoint
DROP POLICY IF EXISTS "memberships_no_self_under_grant_u" ON "tenant_memberships";
--> statement-breakpoint
DROP POLICY IF EXISTS "membership_roles_no_self_under_grant" ON "membership_roles";
--> statement-breakpoint
DROP POLICY IF EXISTS "membership_roles_no_self_under_grant_u" ON "membership_roles";
--> statement-breakpoint

-- Attach a system role to a membership, as the owner. Internal helper for the
-- definers below; not granted to the application.
CREATE OR REPLACE FUNCTION auth_attach_role_internal(
	p_membership_id uuid, p_tenant_id text, p_user_id uuid, p_role_key text
)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_role_id uuid;
BEGIN
	SELECT id INTO v_role_id FROM roles WHERE tenant_id = p_tenant_id AND key = p_role_key;
	IF v_role_id IS NULL THEN
		RETURN;
	END IF;
	INSERT INTO membership_roles (membership_id, role_id, tenant_id, user_id)
	VALUES (p_membership_id, v_role_id, p_tenant_id, p_user_id)
	ON CONFLICT (membership_id, role_id) DO NOTHING;
END;
$$;
--> statement-breakpoint
-- REVOKE FROM PUBLIC is NOT enough: the owner's default privileges (db-grants)
-- grant EXECUTE to campusos_app at creation, so this owner-only helper — which
-- writes any membership_roles row with no authority check — must be revoked from
-- the application BY NAME, or it is itself a self-escalation to tenant_admin.
-- This is the trap communities/0010 already warned Phase 5 depends on. The
-- internal callers are SECURITY DEFINER and run as the owner, so they keep it.
REVOKE ALL ON FUNCTION auth_attach_role_internal(uuid, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	-- Only in a split database, and only if the application is NOT the owner:
	-- on an unsplit development database the app IS the owner and the internal
	-- definer callers run as it, so revoking would break them; there the
	-- guarantee cannot hold anyway. Where the roles are split, the definers run
	-- as campusos_owner and keep EXECUTE, and the application loses it entirely.
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND (
	     SELECT pg_get_userbyid(p.proowner) <> 'campusos_app'
	     FROM pg_proc p
	     WHERE p.proname = 'auth_attach_role_internal'
	       AND p.pronamespace = 'public'::regnamespace
	     LIMIT 1
	   )
	THEN
		EXECUTE 'REVOKE ALL ON FUNCTION auth_attach_role_internal(uuid, text, uuid, text) FROM campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The floor everyone stands on: a self `student` membership, unverified. Anyone
-- may make THEMSELVES a student (the default-role rule); nobody may make anyone
-- else one this way, and a visitor under a grant may not self-join at all.
-- Idempotent: an existing membership is returned untouched.
CREATE OR REPLACE FUNCTION auth_join_as_student(p_tenant_id text)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_id uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF auth_under_tenant_grant() THEN
		RAISE EXCEPTION 'a visitor may not self-join under a grant' USING ERRCODE = '42501';
	END IF;
	PERFORM auth_sync_tenant_roles(p_tenant_id);
	INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
	VALUES (p_tenant_id, v_user, 'student', 'active')
	ON CONFLICT (tenant_id, user_id) DO NOTHING
	RETURNING id INTO v_id;
	IF v_id IS NULL THEN
		SELECT id INTO v_id FROM tenant_memberships
		WHERE tenant_id = p_tenant_id AND user_id = v_user;
		RETURN v_id;
	END IF;
	PERFORM auth_attach_role_internal(v_id, p_tenant_id, v_user, 'student');
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id, 'membership.joined', 'membership', v_id::text,
	        jsonb_build_object('role', 'student', 'verified', false));
	RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Self-verify by domain: the person's own email is on the tenant's list, so the
-- university trusts who they are without a human deciding. The caller passes the
-- allowed domains (the database does not hold them for a file-configured tenant);
-- the definer checks the ACTOR's own email against that list, so it can only ever
-- verify the caller, and only when their address actually matches.
CREATE OR REPLACE FUNCTION auth_verify_self_by_domain(p_tenant_id text, p_allowed_domains text[])
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_email text;
	v_domain text;
	v_id uuid;
	v_created boolean := false;
	v_verified integer := 0;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF auth_under_tenant_grant() THEN
		RAISE EXCEPTION 'a visitor may not self-join under a grant' USING ERRCODE = '42501';
	END IF;
	SELECT lower(email) INTO v_email FROM users WHERE id = v_user;
	IF v_email IS NULL THEN
		RETURN NULL;
	END IF;
	v_domain := split_part(v_email, '@', 2);
	IF v_domain = '' OR NOT EXISTS (
		SELECT 1 FROM unnest(p_allowed_domains) d(dom) WHERE lower(trim(d.dom)) = v_domain
	) THEN
		RETURN NULL; -- not on the domain: no self-verification, no error
	END IF;
	PERFORM auth_sync_tenant_roles(p_tenant_id);
	INSERT INTO tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
	VALUES (p_tenant_id, v_user, 'student', 'active', now(), 'domain')
	ON CONFLICT (tenant_id, user_id) DO NOTHING
	RETURNING id INTO v_id;
	IF v_id IS NOT NULL THEN
		v_created := true;
	ELSE
		SELECT id INTO v_id FROM tenant_memberships
		WHERE tenant_id = p_tenant_id AND user_id = v_user;
		-- Verify an existing unverified row; never downgrade a verified one.
		UPDATE tenant_memberships
		   SET verified_at = now(), verification_method = 'domain'
		 WHERE id = v_id AND verified_at IS NULL;
		GET DIAGNOSTICS v_verified = ROW_COUNT;
	END IF;
	PERFORM auth_attach_role_internal(v_id, p_tenant_id, v_user, 'student');
	-- Only a real change is logged: a returning, already-verified sign in is silent.
	IF v_created OR v_verified > 0 THEN
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_user, p_tenant_id, CASE WHEN v_created THEN 'membership.joined' ELSE 'membership.verified' END,
		        'membership', v_id::text, jsonb_build_object('method', 'domain', 'role', 'student'));
	END IF;
	RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A configured administrator gets their tenant_admin membership at sign in, if
-- their own email is on the tenant's admin list. The 0016 pattern: the caller
-- passes the list, the definer verifies the ACTOR's own address against it, so
-- it can only ever promote the caller. Upgrade only; never downgrades.
CREATE OR REPLACE FUNCTION auth_grant_configured_admin(p_tenant_id text, p_admin_emails text[])
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_email text;
	v_id uuid;
	v_created boolean := false;
	v_had_role boolean;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF auth_under_tenant_grant() THEN
		RAISE EXCEPTION 'a visitor may not self-promote under a grant' USING ERRCODE = '42501';
	END IF;
	SELECT lower(email) INTO v_email FROM users WHERE id = v_user;
	IF v_email IS NULL OR NOT EXISTS (
		SELECT 1 FROM unnest(p_admin_emails) a(entry)
		WHERE lower(trim(a.entry)) = v_email
		  AND a.entry ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
	) THEN
		RETURN NULL;
	END IF;
	PERFORM auth_sync_tenant_roles(p_tenant_id);
	INSERT INTO tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
	VALUES (p_tenant_id, v_user, 'tenant_admin', 'active', now(), 'config')
	ON CONFLICT (tenant_id, user_id) DO NOTHING
	RETURNING id INTO v_id;
	IF v_id IS NOT NULL THEN
		v_created := true;
	ELSE
		SELECT id INTO v_id FROM tenant_memberships
		WHERE tenant_id = p_tenant_id AND user_id = v_user;
		UPDATE tenant_memberships
		   SET role = 'tenant_admin',
		       verified_at = coalesce(verified_at, now()),
		       verification_method = coalesce(verification_method, 'config')
		 WHERE id = v_id;
	END IF;
	-- Already holding the role means nothing changed and nothing is logged.
	SELECT EXISTS (
		SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
		WHERE mr.membership_id = v_id AND r.key = 'tenant_admin'
	) INTO v_had_role;
	PERFORM auth_attach_role_internal(v_id, p_tenant_id, v_user, 'tenant_admin');
	IF v_created OR NOT v_had_role THEN
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_user, p_tenant_id, 'membership.role_granted', 'membership', v_id::text,
		        jsonb_build_object('role', 'tenant_admin', 'source', 'config'));
	END IF;
	RETURN v_id;
END;
$$;
--> statement-breakpoint

-- An administrator verifies another person, from the verification queue. Needs
-- `approve-verifications`; never self (a person does not approve their own
-- request -- the queue enforces that too). Sets verified on an existing
-- membership; returns false if there is none or the caller lacks the power.
CREATE OR REPLACE FUNCTION auth_verify_member(p_tenant_id text, p_target uuid, p_method text)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_id uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'approve-verifications'
	) THEN
		RAISE EXCEPTION 'not allowed to verify members' USING ERRCODE = '42501';
	END IF;
	-- A visitor under a grant may not verify (and so create) their OWN
	-- membership, the same containment every other definer here enforces.
	IF auth_grant_admin_for_txn() IS NOT NULL AND p_target = auth_grant_admin_for_txn() THEN
		RAISE EXCEPTION 'a visitor may not verify their own membership under a grant'
			USING ERRCODE = '42501';
	END IF;
	PERFORM auth_sync_tenant_roles(p_tenant_id);
	-- Create a verified student membership if none exists (as grantVerified did),
	-- else verify the existing one; never downgrade a verified row.
	INSERT INTO tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
	VALUES (p_tenant_id, p_target, 'student', 'active', now(), p_method)
	ON CONFLICT (tenant_id, user_id) DO NOTHING
	RETURNING id INTO v_id;
	IF v_id IS NULL THEN
		SELECT id INTO v_id FROM tenant_memberships
		WHERE tenant_id = p_tenant_id AND user_id = p_target;
		UPDATE tenant_memberships
		   SET verified_at = coalesce(verified_at, now()),
		       verification_method = coalesce(verification_method, p_method)
		 WHERE id = v_id;
	ELSE
		PERFORM auth_attach_role_internal(v_id, p_tenant_id, p_target, 'student');
	END IF;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id, 'membership.verified', 'membership', v_id::text,
	        jsonb_build_object('method', p_method, 'targetUserId', p_target::text));
	RETURN true;
END;
$$;
--> statement-breakpoint

-- Grant or revoke a tenant role on a member. The one writer of `membership_roles`
-- from the application's side. Enforces, in the database, everything the
-- TypeScript used to: `manage-roles` (or a platform admin, the narrow exemption
-- that keeps `communities.unmask` grantable at all); nobody grants a power they
-- do not hold; a tenant keeps at least one administrator; and -- new, replacing
-- the 5A policy -- a visitor under a grant may not grant or revoke a role for
-- THEMSELVES. Returns the outcome as a small text code.
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
	v_from_platform := EXISTS (
		SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_user AND pr.role = 'platform_admin'
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
		-- Nobody grants a power they do not have (platform admin excepted).
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
		WITH removed AS (
			DELETE FROM membership_roles
			WHERE tenant_id = p_tenant_id AND user_id = p_target AND role_id = v_role_id
			RETURNING membership_id
		)
		SELECT count(*)::int, min(membership_id) INTO v_deleted, v_membership_id FROM removed;
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
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_join_as_student(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_verify_self_by_domain(text, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_grant_configured_admin(text, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_verify_member(text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_set_membership_role(text, uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_join_as_student(text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_verify_self_by_domain(text, text[]) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_grant_configured_admin(text, text[]) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_verify_member(text, uuid, text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_set_membership_role(text, uuid, text, boolean) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Standing (restrict / suspend / reinstate) also writes tenant_memberships, so
-- it moves behind a definer too. `restrict-members`, never oneself, never the
-- last active administrator -- the same rules the TypeScript enforced, now in the
-- database. Reason and duration are validated by the caller before this point.
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
	v_id uuid;
	v_admins integer;
	v_target_is_admin boolean;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF p_target = v_user THEN
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_write_standing(text, uuid, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_write_standing(text, uuid, text, text, timestamptz) TO campusos_app';
	END IF;
END
$$;
