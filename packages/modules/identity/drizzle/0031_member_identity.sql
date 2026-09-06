-- Let a tenant admin see a member's real identity -- full name, roll number,
-- sign-in email -- deliberately, one member at a time, every look audited.
--
-- The architecture keeps no real identity after a decision: verification PII
-- lives in verification_request_details only while the request is 'pending' and
-- a trigger purges it the moment the request is decided (0030). users holds the
-- sign-in email but no name or roll number. So there is nothing to look up later
-- unless we CAPTURE the name/roll at the moment of verification, before the purge.
--
-- This migration:
--   * tenant_member_identity: the captured name + roll number, 1:1 per member.
--     RLS enabled, NOT forced, and NO application-facing policy at all -- the app
--     role (a non-owner) is therefore denied every row, and the only reader is the
--     owner-run definer below. db-grants blanket-grants table DML to campusos_app,
--     so RLS -- not a missing grant -- is the boundary (CLAUDE.md 4). No permissive
--     tenant policy is added on purpose: a tenant-wide read policy would expose real
--     identity to any member in the tenant context, exactly what this must prevent.
--   * capture inside auth_verify_member, which every verify path funnels through
--     (approval and manual). It copies the still-live pending detail into
--     tenant_member_identity before decideRequest flips the status (and so before
--     the purge trigger fires) -- "copy before purge". A domain self-verify never
--     collected a name/roll, so it captures nothing; that member's reveal returns
--     the live email with a null name/roll, which is the honest answer.
--   * auth_member_identity: the reveal. SECURITY DEFINER, gated on the new
--     view-member-identity permission through auth_effective_permissions (the
--     unforgeable membership/grant resolver, CLAUDE.md 8), never a bare read. Not
--     authorized -> empty, no leak. The target must be a member of THIS tenant, so
--     there is no cross-tenant or non-member reveal. Every authorized reveal writes
--     a member.identity_viewed audit line (ids only, no PII in meta). No bulk
--     variant: identity is looked at one person at a time, on purpose.
--   * view-member-identity added to the tenant_admin template and backfilled onto
--     existing tenant_admin roles. A platform admin acting under a live grant
--     resolves to the tenant_admin permission set (minus communities.unmask) and so
--     may also reveal -- the audit line, stamped with the actor, is the control, not
--     withholding an administrative lookup from the platform's own operators.

CREATE TABLE "tenant_member_identity" (
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"full_name" text NOT NULL,
	"roll_number" text NOT NULL,
	"captured_via" text NOT NULL,
	"captured_at" timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY ("tenant_id", "user_id")
);
--> statement-breakpoint
-- RLS on, NOT forced. No application-facing policy: the app role is a non-owner,
-- so RLS denies it every row, while the owner-run definers below (not forced) read
-- and write across the tenant. This is the verification_request_details / users
-- pattern, tightened: here the app never needs its own row, so no policy exists.
ALTER TABLE "tenant_member_identity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The new permission on the tenant_admin template, and a backfill onto the
-- existing tenant_admin system roles (the lost-found 0002 pattern).
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'view-member-identity')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, 'view-member-identity'
FROM roles r
WHERE r.key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- auth_verify_member, re-defined to ALSO capture the verified member's real
-- identity. Everything else is unchanged from 0019. The capture reads the member's
-- own still-pending verification detail (present until decideRequest flips the
-- status after this call) and upserts it; a path with no pending detail (a domain
-- or bare manual verify) captures nothing. Owner-run + NOT forced target, so it
-- writes tenant_member_identity across the tenant. CREATE OR REPLACE preserves the
-- existing EXECUTE grant (it stays app-callable).
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
	-- Capture the real identity from the still-live pending detail, before the
	-- purge. Nothing to copy for a path that collected none (domain / bare manual).
	INSERT INTO tenant_member_identity (tenant_id, user_id, full_name, roll_number, captured_via)
	SELECT p_tenant_id, p_target, d.full_name, d.roll_number, p_method
	FROM verification_requests r
	JOIN verification_request_details d ON d.request_id = r.id
	WHERE r.tenant_id = p_tenant_id AND r.user_id = p_target AND r.status = 'pending'
	ORDER BY r.created_at DESC
	LIMIT 1
	ON CONFLICT (tenant_id, user_id) DO UPDATE
		SET full_name = EXCLUDED.full_name,
		    roll_number = EXCLUDED.roll_number,
		    captured_via = EXCLUDED.captured_via,
		    captured_at = now();
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id, 'membership.verified', 'membership', v_id::text,
	        jsonb_build_object('method', p_method, 'targetUserId', p_target::text));
	RETURN true;
END;
$$;
--> statement-breakpoint

-- The reveal. Returns ONE member's identity in ONE tenant to a caller holding
-- view-member-identity, and audits every authorized look. SECURITY DEFINER so it
-- reads tenant_member_identity (no app policy) and users.email (NO FORCE, 0004)
-- across the tenant; not authorized, or not a member here -> empty, no leak. It
-- WRITES the audit row, so it is VOLATILE (not STABLE).
CREATE OR REPLACE FUNCTION auth_member_identity(p_tenant_id text, p_target uuid)
	RETURNS TABLE (
		user_id uuid, handle text, avatar_seed text,
		full_name text, roll_number text, email text,
		captured_via text, captured_at timestamptz
	)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_member uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'view-member-identity'
	) THEN
		RETURN; -- not authorized: empty, no leak (the route already refuses such callers)
	END IF;
	-- The target must belong to this tenant: no cross-tenant, no non-member reveal.
	SELECT m.id INTO v_member FROM tenant_memberships m
	WHERE m.tenant_id = p_tenant_id AND m.user_id = p_target;
	IF v_member IS NULL THEN
		RETURN;
	END IF;
	-- Every authorized reveal is audited, with the actor and target (ids only).
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id, 'member.identity_viewed', 'membership', v_member::text,
	        jsonb_build_object('targetUserId', p_target::text));
	RETURN QUERY
		SELECT p_target,
		       p.handle,
		       coalesce(p.avatar_seed, p_target::text) AS avatar_seed,
		       i.full_name,
		       i.roll_number,
		       u.email,
		       i.captured_via,
		       i.captured_at
		FROM users u
		LEFT JOIN public_profiles p ON p.user_id = u.id
		LEFT JOIN tenant_member_identity i ON i.tenant_id = p_tenant_id AND i.user_id = p_target
		WHERE u.id = p_target;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_member_identity(text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_member_identity(text, uuid) TO campusos_app';
	END IF;
END
$$;
