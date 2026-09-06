-- Ending a session must end its platform grants, not merely make them unusable.
--
-- auth_assume_tenant_grant (0018) already refuses a grant whose session is
-- revoked or expired, so a grant is UNUSABLE the instant its session ends. But
-- auth_open_tenant_grant's "one open grant per admin" guard keys on the grant's
-- own revoked_at/expires_at, not on session liveness, so an unusable grant still
-- reads as open and blocks the admin's next Enter until it expires (up to its
-- 30 minute window). This definer closes that gap: sign-out (and any session
-- revocation) revokes every open grant bound to the ending session, so the row
-- is actually closed and the audit trail says why.
--
-- SECURITY (reviewed as concrete SQL, not design):
--  * This is a DENIAL/cleanup operation. It only sets revoked_at on rows that
--    are already open; it grants no access and cannot escalate privilege. The
--    §8 rule that a PRIVILEGE decision must not key on an app-writable GUC does
--    not bite here, because closing a grant confers nothing.
--  * Even so it is scoped: the caller may only end grants for a session that is
--    THEIR OWN. The session's owner is read from the sessions row (which the app
--    cannot write to claim a different owner) and compared to app.user_id, which
--    the signing-out request sets to that same user. A p_session_id belonging to
--    another user matches nothing and revokes nothing.
--  * Owned by campusos_owner and app-executable by name (it is called from the
--    sign-out path, which runs as the application role).
CREATE OR REPLACE FUNCTION auth_revoke_grants_for_session(p_session_id uuid)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user text := nullif(current_setting('app.user_id', true), '');
	v_uid uuid;
	v_owner uuid;
	v_count integer := 0;
	v_g platform_tenant_grants%ROWTYPE;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	v_uid := v_user::uuid;
	-- The session must be the caller's own. No row, or another user's session,
	-- revokes nothing.
	SELECT s.user_id INTO v_owner FROM sessions s WHERE s.id = p_session_id;
	IF v_owner IS NULL OR v_owner <> v_uid THEN
		RETURN 0;
	END IF;
	FOR v_g IN
		SELECT g.* FROM platform_tenant_grants g
		WHERE g.session_id = p_session_id AND g.revoked_at IS NULL
	LOOP
		UPDATE platform_tenant_grants
		   SET revoked_at = now(), revoked_by = v_uid, revoke_reason = 'session_ended'
		 WHERE id = v_g.id AND revoked_at IS NULL;
		INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
		VALUES (v_uid, v_g.tenant_id, 'platform.tenant_grant_closed', 'tenant_grant',
		        v_g.id::text, jsonb_build_object('admin', v_g.admin_user_id::text, 'via', 'session_end'));
		v_count := v_count + 1;
	END LOOP;
	RETURN v_count;
END;
$$;
--> statement-breakpoint
-- App-callable: the sign-out path runs as campusos_app. Revoke the ambient
-- PUBLIC/default grant first, then grant by name (split databases only).
REVOKE ALL ON FUNCTION auth_revoke_grants_for_session(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_revoke_grants_for_session(uuid) TO campusos_app';
	END IF;
END
$$;
