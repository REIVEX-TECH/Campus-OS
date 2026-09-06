-- Lost & Found moderation: reporting an item or a claim, the moderator queue,
-- and the lostfound.moderate permission.
--
-- Because claims connect strangers, reporting + a moderation queue ship with the
-- claim feature (CLAUDE.md 8). A report is the reporter's own row (RLS own-insert
-- / own-read); moderators read the queue and resolve reports only through
-- SECURITY DEFINER functions gated on lostfound.moderate via
-- auth_effective_permissions (membership for a resident admin; the grant use-row
-- for a platform admin under a grant). Item removal is an ordinary application
-- update, permission-checked in the transaction, the communities pattern.

CREATE TABLE "lf_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"note" text,
	"status" text NOT NULL DEFAULT 'open',
	"resolution" text,
	"resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"resolved_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lf_reports_one_per_reporter_uq" ON "lf_reports" ("target_type", "target_id", "reporter_id");
--> statement-breakpoint
CREATE INDEX "lf_reports_queue_idx" ON "lf_reports" ("tenant_id", "status", "created_at");
--> statement-breakpoint

-- Own-insert / own-read; moderators read and resolve via the definers below.
-- NO FORCE so those owner-run definers can see and update across reporters; the
-- application role is a non-owner and stays confined to its own rows.
ALTER TABLE "lf_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lf_reports_own" ON "lf_reports" FOR ALL
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "reporter_id"::text = current_setting('app.user_id', true)
	)
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "reporter_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint

-- Grant lostfound.moderate to the tenant_admin template, and backfill the roles
-- already materialised from it, so existing and future administrators moderate.
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'lostfound.moderate')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, 'lostfound.moderate'
FROM roles r
WHERE r.key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The moderator queue: open reports with just enough of the target to triage,
-- including a reported claim's message (claims are otherwise participant-only).
-- Gated on lostfound.moderate; not authorized -> empty. Reads lf_items through
-- its tenant policy (the definer runs in the caller's tenant context) and the
-- NO-FORCE lf_claims / lf_reports by owner-bypass.
CREATE OR REPLACE FUNCTION auth_lf_report_queue(p_tenant_id text)
	RETURNS TABLE (
		report_id uuid, target_type text, target_id uuid, reason text, note text,
		created_at timestamptz, reporter_handle text, item_id uuid, item_title text,
		claim_message text
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
		WHERE p.permission = 'lostfound.moderate'
	) THEN
		RETURN;
	END IF;
	RETURN QUERY
		SELECT r.id,
		       r.target_type,
		       r.target_id,
		       r.reason,
		       r.note,
		       r.created_at,
		       rp.handle,
		       coalesce(i.id, ci.id) AS item_id,
		       coalesce(i.title, ci.title) AS item_title,
		       c.message
		FROM lf_reports r
		LEFT JOIN public_profiles rp ON rp.user_id = r.reporter_id
		LEFT JOIN lf_items i ON r.target_type = 'lf_item' AND i.id = r.target_id
		LEFT JOIN lf_claims c ON r.target_type = 'lf_claim' AND c.id = r.target_id
		LEFT JOIN lf_items ci ON r.target_type = 'lf_claim' AND ci.id = c.item_id
		WHERE r.tenant_id = p_tenant_id AND r.status = 'open'
		ORDER BY r.created_at ASC
		LIMIT 200;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lf_report_queue(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_lf_report_queue(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Resolve every open report on one target. Gated on lostfound.moderate; the
-- resolution ('removed' | 'dismissed') is recorded with the moderator.
CREATE OR REPLACE FUNCTION auth_lf_resolve_reports(
	p_tenant_id text, p_target_type text, p_target_id uuid, p_resolution text
)
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
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'lostfound.moderate'
	) THEN
		RETURN 0;
	END IF;
	UPDATE lf_reports
	   SET status = 'resolved', resolution = p_resolution, resolved_by = v_user, resolved_at = now()
	 WHERE tenant_id = p_tenant_id AND target_type = p_target_type
	   AND target_id = p_target_id AND status = 'open';
	GET DIAGNOSTICS v_count = ROW_COUNT;
	RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lf_resolve_reports(text, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_lf_resolve_reports(text, text, uuid, text) TO campusos_app';
	END IF;
END
$$;
