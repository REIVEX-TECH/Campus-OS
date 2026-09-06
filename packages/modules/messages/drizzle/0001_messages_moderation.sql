-- Moderation for direct messages. A message is private to its two participants
-- (0000), so a moderator is NOT a participant and cannot read the live thread.
-- Reporting therefore captures a SNAPSHOT of the reported message and the few
-- around it, taken in the reporter's own context (they can read their own
-- conversation), and that snapshot is what a moderator reads through a definer
-- gated on `messages.moderate`. The reporting UI says so plainly.
--
-- msg_reports is own-insert / own-read for the reporter (RLS), NOT forced, so the
-- two owner-run definers below read and resolve across reporters while the
-- application role stays confined to its own rows (the lost-found lf_reports
-- pattern). Removing a reported message tombstones it in msg_messages (NO FORCE
-- there lets the owner definer reach across the participants).

CREATE TABLE "msg_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"message_id" uuid NOT NULL REFERENCES "msg_messages"("id") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "msg_conversations"("id") ON DELETE CASCADE,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"note" text,
	-- The reported message plus the surrounding few, captured at report time so
	-- moderation does not depend on reading a conversation it is not part of, and
	-- survives a later delete.
	"snapshot" jsonb NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "msg_reports_one_per_reporter" ON "msg_reports" ("message_id", "reporter_id");
--> statement-breakpoint
CREATE INDEX "msg_reports_queue_idx" ON "msg_reports" ("tenant_id", "status", "created_at");
--> statement-breakpoint

ALTER TABLE "msg_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Own-row for the application role. NOT forced: the definers below (owner-run)
-- read across reporters and resolve; the app role, a non-owner, stays bound.
CREATE POLICY "msg_reports_own_read" ON "msg_reports" FOR SELECT
	USING ("reporter_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "msg_reports_own_insert" ON "msg_reports" FOR INSERT
	WITH CHECK (
		"reporter_id"::text = current_setting('app.user_id', true)
		AND "tenant_id" = current_setting('app.tenant_id', true)
	);
--> statement-breakpoint

-- messages.moderate on the tenant_admin template, backfilled onto existing roles
-- (the lost-found 0002 pattern). The permission exists only alongside its guard,
-- the definers below.
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'messages.moderate')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, 'messages.moderate'
FROM roles r
WHERE r.key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The moderator queue: open reports of ONE tenant with their snapshot, oldest
-- first, gated on messages.moderate via auth_effective_permissions. Not
-- authorized -> empty, no leak. The handle comes from public_profiles.
CREATE OR REPLACE FUNCTION auth_msg_report_queue(p_tenant_id text)
	RETURNS TABLE (
		id uuid, message_id uuid, conversation_id uuid,
		reporter_id uuid, reporter_handle text,
		reason text, note text, snapshot jsonb, created_at timestamptz
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
		WHERE p.permission = 'messages.moderate'
	) THEN
		RETURN; -- not authorized: empty, no leak
	END IF;
	RETURN QUERY
		SELECT r.id, r.message_id, r.conversation_id,
		       r.reporter_id, p.handle,
		       r.reason, r.note, r.snapshot, r.created_at
		FROM msg_reports r
		LEFT JOIN public_profiles p ON p.user_id = r.reporter_id
		WHERE r.tenant_id = p_tenant_id AND r.status = 'open'
		ORDER BY r.created_at ASC
		LIMIT 200;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_msg_report_queue(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_msg_report_queue(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Resolve every open report on one message, gated on messages.moderate. On
-- 'removed' the message is tombstoned (its body dropped) across the participants;
-- 'dismissed' just closes the reports. Returns the number of reports closed.
CREATE OR REPLACE FUNCTION auth_msg_resolve_reports(p_tenant_id text, p_message_id uuid, p_resolution text)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_count integer;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF p_resolution NOT IN ('removed', 'dismissed') THEN
		RAISE EXCEPTION 'bad resolution' USING ERRCODE = '22023';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'messages.moderate'
	) THEN
		RETURN 0; -- not authorized: nothing resolved, no leak
	END IF;
	IF p_resolution = 'removed' THEN
		UPDATE msg_messages SET deleted_at = coalesce(deleted_at, now()), body = ''
		WHERE id = p_message_id AND tenant_id = p_tenant_id;
	END IF;
	UPDATE msg_reports
	   SET status = 'resolved', resolution = p_resolution, resolved_by = v_user, resolved_at = now()
	 WHERE tenant_id = p_tenant_id AND message_id = p_message_id AND status = 'open';
	GET DIAGNOSTICS v_count = ROW_COUNT;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, p_tenant_id, 'message.moderated', 'message', p_message_id::text,
	        jsonb_build_object('resolution', p_resolution));
	RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_msg_resolve_reports(text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_msg_resolve_reports(text, uuid, text) TO campusos_app';
	END IF;
END
$$;
