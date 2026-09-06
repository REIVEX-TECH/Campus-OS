-- Ephemerality for direct messages. A conversation's `ephemerality` (never |
-- after_24h | after_viewing, set per conversation, default 'never') decides when
-- its messages expire:
--   * after_24h: stamped at send (expires_at = created_at + 24h);
--   * after_viewing: stamped when the RECIPIENT first views it (expires_at =
--     now() + a short grace), so it does not vanish mid-read.
--
-- Read queries filter out expires_at <= now(); a scheduled sweep HARD-deletes
-- expired rows so they do not linger. Two owner-run definers do the writing:
--
--   1. auth_msg_expire deletes a tenant's expired messages. It must be a definer,
--      NOT an application-role DELETE with a policy: a DELETE scans the rows it
--      removes, and that scan is subject to the participant SELECT policy (0000),
--      which the sweep -- running with no actor -- cannot satisfy, so an app-role
--      DELETE would remove nothing. The owner (NO FORCE) sees across and deletes;
--      it removes ONLY already-expired rows, so even called freely it can drop
--      nothing that has not expired and touches no other tenant.
--
--   2. auth_msg_stamp_viewed stamps after_viewing on first view. The viewer is
--      the RECIPIENT, not the sender, so the own-message UPDATE policy (0000)
--      would block them from setting expiry on the sender's message. The definer
--      does it, gated on the caller being a participant of the conversation (read
--      through the RLS-filtered msg_conversations, so a non-participant stamps
--      nothing), and only on that conversation's not-yet-viewed inbound messages.

CREATE OR REPLACE FUNCTION auth_msg_expire(p_tenant_id text)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_count integer;
BEGIN
	DELETE FROM msg_messages
	 WHERE tenant_id = p_tenant_id
	   AND expires_at IS NOT NULL
	   AND expires_at <= now();
	GET DIAGNOSTICS v_count = ROW_COUNT;
	RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_msg_expire(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_msg_expire(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_msg_stamp_viewed(
	p_tenant_id text,
	p_conversation_id uuid,
	p_grace_seconds integer
)
	RETURNS void
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
	-- The caller must be a participant of this after_viewing conversation.
	IF NOT EXISTS (
		SELECT 1 FROM msg_conversations c
		WHERE c.id = p_conversation_id
		  AND c.tenant_id = p_tenant_id
		  AND c.ephemerality = 'after_viewing'
		  AND (c.participant_a = v_user OR c.participant_b = v_user)
	) THEN
		RETURN;
	END IF;
	-- Stamp the messages the caller received here that have not been viewed yet:
	-- first view fixes both the view time and a short expiry (the grace window).
	UPDATE msg_messages
	   SET first_viewed_at = now(),
	       expires_at = now() + (greatest(p_grace_seconds, 0) * interval '1 second')
	 WHERE conversation_id = p_conversation_id
	   AND tenant_id = p_tenant_id
	   AND sender_id <> v_user
	   AND first_viewed_at IS NULL
	   AND deleted_at IS NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_msg_stamp_viewed(text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_msg_stamp_viewed(text, uuid, integer) TO campusos_app';
	END IF;
END
$$;
