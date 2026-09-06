-- Ephemerality for direct messages. A conversation's `ephemerality` (never |
-- after_24h | after_viewing, set per conversation, default 'never') decides when
-- its messages expire:
--   * after_24h: stamped at send (expires_at = created_at + 24h);
--   * after_viewing: stamped when the RECIPIENT first views it (expires_at =
--     now() + a short grace), so it does not vanish mid-read.
--
-- Read queries filter out expires_at <= now(); a scheduled sweep HARD-deletes
-- expired rows so they do not linger. Two SQL pieces are needed here:
--
--   1. A DELETE policy so the cleanup sweep (no actor, tenant context) can remove
--      ONLY already-expired rows as the application role. It keys on the tenant
--      GUC and expires_at, never on app.user_id: this is a maintenance capability
--      scoped to expired rows, not an authorization decision, and it can delete
--      nothing that has not already expired.
--
--   2. An owner-run definer to stamp after_viewing on first view. The viewer is
--      the RECIPIENT, not the sender, so the own-message UPDATE policy (0000)
--      would block them from setting expiry on the sender's message. The definer
--      does it, gated on the caller being a participant of the conversation (read
--      through the RLS-filtered msg_conversations, so a non-participant stamps
--      nothing), and only on that conversation's not-yet-viewed inbound messages.

CREATE POLICY "msg_messages_expire_delete" ON "msg_messages" FOR DELETE
	USING (
		tenant_id = current_setting('app.tenant_id', true)
		AND expires_at IS NOT NULL
		AND expires_at <= now()
	);
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
