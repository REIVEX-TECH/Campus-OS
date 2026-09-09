-- Rides safety: reporting a ride or a person, the moderation queue, moderator
-- removal, and the rides.moderate permission.
--
-- Because rides put strangers in a car together, reporting + a moderation queue
-- ship with the feature (CLAUDE.md 8), mirroring Lost & Found (0002). A report is
-- the reporter's own row (own-insert / own-read); moderators read the queue and
-- resolve reports only through SECURITY DEFINER functions gated on rides.moderate
-- via auth_effective_permissions (membership for a resident admin; the grant
-- use-row for a platform admin under a grant). N open reports on one ride hide it
-- pending a moderator; removal is an ordinary permission-checked update.

-- Moderator removal + threshold hide state on the ride.
ALTER TABLE "ride_posts" ADD COLUMN "removed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "ride_posts" ADD COLUMN "removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "ride_posts" ADD COLUMN "removal_reason" text;
--> statement-breakpoint
ALTER TABLE "ride_posts" ADD COLUMN "hidden_at" timestamptz;
--> statement-breakpoint

CREATE TABLE "ride_reports" (
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
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "ride_reports_target_ck" CHECK ("target_type" IN ('ride_post', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ride_reports_one_per_reporter_uq"
	ON "ride_reports" ("target_type", "target_id", "reporter_id");
--> statement-breakpoint
CREATE INDEX "ride_reports_queue_idx" ON "ride_reports" ("tenant_id", "status", "created_at");
--> statement-breakpoint

-- Own-insert / own-read; moderators read and resolve via the definers below. NO
-- FORCE so those owner-run definers see and update across reporters; the app role
-- is a non-owner and stays confined to its own rows.
ALTER TABLE "ride_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ride_reports_own" ON "ride_reports" FOR ALL
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "reporter_id"::text = current_setting('app.user_id', true)
	)
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "reporter_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint

-- Grant rides.moderate to the tenant_admin template and backfill the roles already
-- materialised from it, so existing and future administrators moderate.
INSERT INTO "role_template_permissions" ("template_key", "permission")
VALUES ('tenant_admin', 'rides.moderate')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, 'rides.moderate'
FROM roles r
WHERE r.key = 'tenant_admin' AND r.is_system = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The moderator queue: open reports with enough of the target to triage. Gated on
-- rides.moderate; not authorized -> empty. Reads ride_posts (its tenant policy
-- passes in the caller's tenant context) and the reporter/reported handles.
CREATE OR REPLACE FUNCTION auth_rides_report_queue(p_tenant_id text)
	RETURNS TABLE (
		report_id uuid, target_type text, target_id uuid, reason text, note text,
		created_at timestamptz, reporter_handle text,
		ride_origin text, ride_dest text, reported_handle text
	)
	LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'rides.moderate'
	) THEN
		RETURN;
	END IF;
	RETURN QUERY
		SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at,
		       rp.handle,
		       rd.origin_text, rd.dest_text,
		       up.handle
		FROM ride_reports r
		LEFT JOIN public_profiles rp ON rp.user_id = r.reporter_id
		LEFT JOIN ride_posts rd ON r.target_type = 'ride_post' AND rd.id = r.target_id
		LEFT JOIN public_profiles up ON r.target_type = 'user' AND up.user_id = r.target_id
		WHERE r.tenant_id = p_tenant_id AND r.status = 'open'
		ORDER BY r.created_at ASC
		LIMIT 200;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_rides_report_queue(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_rides_report_queue(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Resolve every open report on one target. Gated on rides.moderate; the resolution
-- ('removed' | 'dismissed') is recorded with the moderator. Returns the count.
CREATE OR REPLACE FUNCTION auth_rides_resolve_reports(
	p_tenant_id text, p_target_type text, p_target_id uuid, p_resolution text
)
	RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_count integer;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, p_tenant_id) p
		WHERE p.permission = 'rides.moderate'
	) THEN
		RETURN 0;
	END IF;
	UPDATE ride_reports
	   SET status = 'resolved', resolution = p_resolution, resolved_by = v_user, resolved_at = now()
	 WHERE tenant_id = p_tenant_id AND target_type = p_target_type
	   AND target_id = p_target_id AND status = 'open';
	GET DIAGNOSTICS v_count = ROW_COUNT;
	RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_rides_resolve_reports(text, text, uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_rides_resolve_reports(text, text, uuid, text) TO campusos_app';
	END IF;
END
$$;
