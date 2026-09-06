-- Move the standing moderation text off the tenant-wide-readable membership row.
--
-- Composed-review M2, the M1 shape (0030) applied to standing. tenant_memberships
-- is read tenant-wide (memberships_read: user_id = app.user_id OR tenant_id =
-- app.tenant_id) and by other modules, which is right for the roster columns --
-- but the row also held standing_reason (why a member was restricted/suspended)
-- and appeal_note (the member's appeal, often personal), moderation text confined
-- only by the readers remembering to hold restrict-members. RLS is the boundary
-- (CLAUDE.md 4), so the two text columns move to their own table.
--
-- membership_standing_details (standing_reason, appeal_note), 1:1 with a
-- membership:
--   * own-row RLS for the member (their standing notice reads their own reason and
--     appeal), keyed on app.user_id;
--   * NO FORCE, so the owner-run definers (the admin read and the write/appeal
--     definers) see across the tenant while the application role stays confined to
--     its own row;
--   * admin reads ONLY through auth_standings_for_tenant, gated on restrict-members
--     via auth_effective_permissions;
--   * writes ONLY through the existing definers (auth_write_standing,
--     auth_appeal_standing), rewritten below; the application role has no write on
--     the table.
--
-- Lifecycle / carry-over (decided explicitly, because these are mutable state, not
-- write-once PII): the detail row exists exactly while the membership is under a
-- non-active standing. A new standing decision sets its reason and CLEARS any
-- pending appeal (an appeal is about one decision; the next decision answers it).
-- Reinstatement (status -> active) DELETES the row: reason and appeal both gone. So
-- an appeal note survives precisely as long as the standing it appeals, and no
-- longer -- the guarantee auth_write_standing made by nulling the columns, kept.
-- (standing_until / standing_at / standing_by / appeal_at stay on the membership
-- row: they are not sensitive, and standing_until is read by the resolver.)
--
-- The moderation reason is also written into audit_log.meta, by design: that is the
-- accountability record, read by administrators and the actor, and is out of scope
-- here (this finding was the membership row). The append-only audit trail keeps it.

CREATE TABLE "membership_standing_details" (
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"standing_reason" text,
	"appeal_note" text,
	PRIMARY KEY ("tenant_id", "user_id")
);
--> statement-breakpoint
ALTER TABLE "membership_standing_details" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Own-row for the application role. NO FORCE (not asserted): the owner-run definers
-- below read and write across the tenant; the application role, a non-owner, stays
-- bound to this policy and gets only its own row.
CREATE POLICY "own_standing_details_read" ON "membership_standing_details" FOR SELECT
	USING ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT ON membership_standing_details TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Copy the live moderation text. tenant_memberships is NO FORCE, so the migration
-- (campusos_owner, NOBYPASSRLS) reads it directly. appeal_note is only ever set
-- alongside a non-active standing, so a row with either column set has a standing.
INSERT INTO "membership_standing_details" (tenant_id, user_id, standing_reason, appeal_note)
	SELECT tenant_id, user_id, standing_reason, appeal_note
	FROM tenant_memberships
	WHERE standing_reason IS NOT NULL OR appeal_note IS NOT NULL;
--> statement-breakpoint

-- Rewrite the standing writer: the same guards, but reason/appeal live in the side
-- table now. A non-active standing upserts its reason and clears any pending
-- appeal; reinstatement removes the row.
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
	       standing_until = CASE WHEN p_status = 'active' THEN NULL ELSE p_until END,
	       standing_by = v_user,
	       standing_at = now(),
	       appeal_at = NULL
	 WHERE id = v_id;
	-- The moderation text: reinstatement clears it (row gone); a non-active standing
	-- carries its reason and, being a fresh decision, clears any pending appeal.
	IF p_status = 'active' THEN
		DELETE FROM membership_standing_details WHERE tenant_id = p_tenant_id AND user_id = p_target;
	ELSE
		INSERT INTO membership_standing_details (tenant_id, user_id, standing_reason, appeal_note)
		VALUES (p_tenant_id, p_target, p_reason, NULL)
		ON CONFLICT (tenant_id, user_id) DO UPDATE
		   SET standing_reason = EXCLUDED.standing_reason, appeal_note = NULL;
	END IF;
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

-- Rewrite the appeal writer: the note lives in the side table; appeal_at stays on
-- the membership row. Still reads the caller from the session (never a passed id),
-- so it can only ever write the caller's own appeal, and only against a standing.
CREATE OR REPLACE FUNCTION auth_appeal_standing(p_tenant_id text, p_note text)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_updated integer;
BEGIN
	IF v_user IS NULL THEN
		RETURN false;
	END IF;
	UPDATE tenant_memberships
	   SET appeal_at = now()
	 WHERE tenant_id = p_tenant_id
	   AND user_id = v_user
	   -- An appeal is about a decision, so there has to be one standing.
	   AND status <> 'active'
	   AND (standing_until IS NULL OR standing_until > now());
	GET DIAGNOSTICS v_updated = ROW_COUNT;
	IF v_updated = 0 THEN
		RETURN false;
	END IF;
	-- The detail row exists whenever a non-active standing does (auth_write_standing
	-- created it), so the note lands on the caller's own row.
	UPDATE membership_standing_details
	   SET appeal_note = p_note
	 WHERE tenant_id = p_tenant_id AND user_id = v_user;
	RETURN true;
END;
$$;
--> statement-breakpoint

-- The admin read: who is under a standing here, with reason and appeal, oldest
-- decision first. Gated on restrict-members through auth_effective_permissions
-- (membership for a resident admin; the grant use-row for a platform admin under a
-- grant). SECURITY DEFINER so it reads the detail text across the tenant; not
-- authorized -> empty. Handle comes from public_profiles, never an email.
CREATE OR REPLACE FUNCTION auth_standings_for_tenant(p_tenant_id text)
	RETURNS TABLE (
		user_id uuid, handle text, avatar_seed text, status text,
		standing_reason text, standing_until timestamptz, standing_at timestamptz,
		appeal_note text, appeal_at timestamptz
	)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'restrict-members'
	) THEN
		RETURN; -- not authorized: empty, no leak (the route already refuses such callers)
	END IF;
	RETURN QUERY
		SELECT m.user_id,
		       p.handle,
		       coalesce(p.avatar_seed, m.user_id::text) AS avatar_seed,
		       m.status,
		       d.standing_reason,
		       m.standing_until,
		       m.standing_at,
		       d.appeal_note,
		       m.appeal_at
		FROM tenant_memberships m
		LEFT JOIN membership_standing_details d
		       ON d.tenant_id = m.tenant_id AND d.user_id = m.user_id
		LEFT JOIN public_profiles p ON p.user_id = m.user_id
		WHERE m.tenant_id = p_tenant_id
		  AND m.status <> 'active'
		  AND (m.standing_until IS NULL OR m.standing_until > now())
		ORDER BY m.standing_at DESC NULLS LAST;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_standings_for_tenant(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_standings_for_tenant(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The moderation text now lives only in membership_standing_details.
ALTER TABLE "tenant_memberships" DROP COLUMN "standing_reason";
--> statement-breakpoint
ALTER TABLE "tenant_memberships" DROP COLUMN "appeal_note";
