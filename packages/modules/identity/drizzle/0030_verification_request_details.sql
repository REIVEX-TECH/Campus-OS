-- Move the verification-request PII off the tenant-wide-readable row.
--
-- verification_requests.requests_read (0009) is tenant-wide: `user_id =
-- app.user_id OR tenant_id = app.tenant_id`. That is right for what the row
-- leaves behind -- status and timestamps, which the rate limit, dashboards and
-- audit trail read -- but the row ALSO held full_name, roll_number and note: a
-- student's government-checkable identity, readable by anyone the application
-- placed in the tenant's context, not only the holders of approve-verifications.
-- No in-tree query reads those columns un-gated today, but RLS is the boundary
-- (CLAUDE.md 4), not the application's memory to add a permission filter.
--
-- So the PII moves to its own table, verification_request_details, keyed 1:1 to
-- the request:
--   * own-row RLS for the requester (they may read and write their own, nobody
--     else's), keyed on app.user_id -- their own low-stakes data, the user_recents
--     shape;
--   * NO FORCE, so the two owner-run definers below (the admin read and the purge
--     trigger) see across the tenant while the application role stays confined to
--     its own row -- the tenant_memberships / users pattern;
--   * admin reads ONLY through auth_pending_verification_requests, gated on
--     approve-verifications via auth_effective_permissions (the unforgeable
--     grant/membership resolver, CLAUDE.md 8), never a bare tenant read;
--   * purge is automatic: a SECURITY DEFINER trigger deletes the detail the moment
--     its request leaves 'pending' (decided or superseded), so the PII cannot
--     outlive the one job it exists for -- the guarantee decideRequest used to make
--     by setting the columns null, now enforced in the database and unforgettable.

CREATE TABLE "verification_request_details" (
	"request_id" uuid PRIMARY KEY REFERENCES "verification_requests"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"full_name" text NOT NULL,
	"roll_number" text NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "verification_request_details" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Own-row for the application role. NO FORCE (not asserted): the owner-run definer
-- and trigger below must read and purge across the tenant; the application role,
-- which is not the owner, stays bound to these policies.
CREATE POLICY "own_request_details_read" ON "verification_request_details" FOR SELECT
	USING ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "own_request_details_insert" ON "verification_request_details" FOR INSERT
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT, INSERT ON verification_request_details TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Copy the PII that is still live (a pending request holds it; a decided one had
-- it purged to NULL). The migration runs as campusos_owner, which is NOBYPASSRLS,
-- so it cannot read the FORCE-protected verification_requests without a tenant
-- context: drop FORCE for the copy and restore it immediately. This runs inside
-- the migration transaction, with no application traffic, so the window is not
-- observable.
ALTER TABLE "verification_requests" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "verification_request_details" (request_id, tenant_id, user_id, full_name, roll_number, note)
	SELECT id, tenant_id, user_id, full_name, roll_number, note
	FROM verification_requests
	WHERE full_name IS NOT NULL AND roll_number IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Purge on close. Fires when a request leaves 'pending' (decided or superseded);
-- SECURITY DEFINER so it deletes the detail row (NO FORCE lets the owner across
-- RLS) regardless of who ran the status change. Owner-only: the trigger machinery
-- fires it, the application never calls it, so its EXECUTE is revoked.
CREATE OR REPLACE FUNCTION verification_request_details_purge()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
BEGIN
	IF NEW.status <> 'pending' AND OLD.status = 'pending' THEN
		DELETE FROM verification_request_details WHERE request_id = NEW.id;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION verification_request_details_purge() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND (
	     SELECT pg_get_userbyid(p.proowner) <> 'campusos_app'
	     FROM pg_proc p
	     WHERE p.proname = 'verification_request_details_purge'
	       AND p.pronamespace = 'public'::regnamespace
	     LIMIT 1
	   )
	THEN
		EXECUTE 'REVOKE ALL ON FUNCTION verification_request_details_purge() FROM campusos_app';
	END IF;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "verification_request_details_purge" ON "verification_requests";
--> statement-breakpoint
CREATE TRIGGER "verification_request_details_purge"
	AFTER UPDATE ON "verification_requests"
	FOR EACH ROW EXECUTE FUNCTION verification_request_details_purge();
--> statement-breakpoint

-- The admin read. Returns the pending requests of ONE tenant with their details,
-- oldest first, gated on approve-verifications resolved through
-- auth_effective_permissions (membership for a resident admin; the grant use-row
-- for a platform admin under a live grant). SECURITY DEFINER so it reads the
-- details across the tenant; not authorized -> empty, no leak. The handle comes
-- from public_profiles, so no email is ever read.
CREATE OR REPLACE FUNCTION auth_pending_verification_requests(p_tenant_id text)
	RETURNS TABLE (
		id uuid, user_id uuid, handle text, avatar_seed text,
		full_name text, roll_number text, note text, created_at timestamptz
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
		WHERE p.permission = 'approve-verifications'
	) THEN
		RETURN; -- not authorized: empty, no leak (the route already refuses such callers)
	END IF;
	RETURN QUERY
		SELECT r.id,
		       r.user_id,
		       p.handle,
		       coalesce(p.avatar_seed, r.user_id::text) AS avatar_seed,
		       d.full_name,
		       d.roll_number,
		       d.note,
		       r.created_at
		FROM verification_requests r
		JOIN verification_request_details d ON d.request_id = r.id
		LEFT JOIN public_profiles p ON p.user_id = r.user_id
		WHERE r.tenant_id = p_tenant_id AND r.status = 'pending'
		ORDER BY r.created_at ASC
		LIMIT 100;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_pending_verification_requests(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_pending_verification_requests(text) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The PII now lives only in verification_request_details. Drop it from the
-- tenant-wide-readable row.
ALTER TABLE "verification_requests" DROP COLUMN "full_name";
--> statement-breakpoint
ALTER TABLE "verification_requests" DROP COLUMN "roll_number";
--> statement-breakpoint
ALTER TABLE "verification_requests" DROP COLUMN "note";
