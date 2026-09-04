-- Cross-tenant platform administration, as an audited capability, not a status.
--
-- A platform administrator administers the platform: universities, role
-- definitions, the bootstrap. It has never administered a university, because
-- `auth_effective_permissions` needs a membership row and a platform admin has
-- none, so one standing inside a tenant resolves to nothing and every admin
-- surface 404s. That gate is real but it is an application gate: it holds
-- because no code path exists, not because the database refuses.
--
-- What is wanted is narrower than "platform admins can administer tenants". It
-- is: for a stated reason, for a short while, in exactly ONE named university, a
-- platform administrator may do what that university's own administrator may do.
-- Breadth, never depth. The unit is a grant, and a grant is a row.
--
-- Four properties are load bearing, and each is a mechanism, not a convention:
--
--  1. Entering a tenant and recording it are ONE statement. `auth_open_tenant_grant`
--     writes the audit row, creates the grant, and sets `app.tenant_id` together;
--     if the write fails the call raises and no context was set. Access that was
--     not logged is not representable.
--
--  2. Whether a request is acting under a grant is decided by a ROW the
--     application cannot write, never by a setting it can clear. Each granted
--     transaction inserts a `platform_grant_uses` row stamped with its own
--     transaction id; the resolver and the subtraction below both key on
--     "is there a use row for THIS transaction id", read through a definer over
--     a table the application has no write on. Clearing a GUC changes nothing.
--
--  3. Inside the tenant the grant is EXACTLY that tenant's tenant_admin, minus
--     `communities.unmask`. De-anonymising a student is the sharpest power in
--     the product; a visitor is deliberately narrower than the resident admin,
--     which is the only safe direction to differ.
--
--  4. The grant cannot be turned into a permanent membership. Under a grant the
--     administrator may not write themselves a membership or a role, and may not
--     touch the platform-level tables (role definitions, tenant configs,
--     universities) that a tenant administrator cannot touch either. Those are
--     RESTRICTIVE policies keyed on property 2's unforgeable row.
--
-- Authentication is the session, not a secret. Granted access is driven from the
-- platform host, where `/u/{slug}/...` renders the tenant surface with the
-- administrator's own already-resolved session (planRoute returns {next, slug}
-- there); the grant is bound to that `session_id`, so signing out ends every
-- visit and there is no second credential to carry, leak, or strand.
--
-- Phase 5A is the security core only: the tables, the functions, the resolver,
-- the subtraction, and a `withPlatformGrant` helper. NO admin surface runs
-- inside a granted transaction yet, so on the bare connection pool
-- `auth_effective_permissions` still resolves a platform admin to nothing and
-- every surface stays 404 until 5B opens them deliberately, one granted
-- transaction at a time.

CREATE TABLE "platform_tenant_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	-- Bound to the session that opened it: signing out (the row is deleted or
	-- revoked) ends the visit, with no bookkeeping of our own.
	"session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"opened_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"revoked_at" timestamptz,
	"revoked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"revoke_reason" text,
	-- The opening audit line. A grant that was never logged is unspellable: the
	-- column is NOT NULL and the FK into an append-only table means TRUNCATE
	-- audit_log cannot erase the trail while a grant references it.
	"audit_id" bigint NOT NULL REFERENCES "audit_log"("id"),
	CONSTRAINT "platform_tenant_grants_reason_ck"
		CHECK (length(btrim("reason")) BETWEEN 12 AND 500),
	CONSTRAINT "platform_tenant_grants_window_ck"
		CHECK ("expires_at" > "opened_at" AND "expires_at" <= "opened_at" + interval '4 hours')
);
--> statement-breakpoint
CREATE INDEX "platform_tenant_grants_admin_idx"
	ON "platform_tenant_grants" ("admin_user_id", "opened_at" DESC);
--> statement-breakpoint
CREATE INDEX "platform_tenant_grants_tenant_idx"
	ON "platform_tenant_grants" ("tenant_id", "opened_at" DESC);
--> statement-breakpoint
CREATE INDEX "platform_tenant_grants_live_idx"
	ON "platform_tenant_grants" ("admin_user_id", "expires_at")
	WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- At most one open grant per administrator, platform-wide: breadth is one tenant
-- at a time, not many at once. Race-proof, unlike a check-then-insert; the open
-- function closes any expired-but-unrevoked grant first so this never wedges.
CREATE UNIQUE INDEX "platform_tenant_grants_one_open_idx"
	ON "platform_tenant_grants" ("admin_user_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint

-- One row per granted transaction, stamped with that transaction's id. This is
-- the unforgeable proof of property 2: the application has no write on this
-- table, so it cannot create, alter, or delete a use row, and cannot make the
-- resolver or the subtraction believe a transaction is (or is not) under a grant.
CREATE TABLE "platform_grant_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL REFERENCES "platform_tenant_grants"("id") ON DELETE CASCADE,
	"at" timestamptz DEFAULT now() NOT NULL,
	"txid" xid8 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_grant_uses_grant_idx"
	ON "platform_grant_uses" ("grant_id", "at" DESC);
--> statement-breakpoint
-- The proof lookup is by transaction id; index it so it is a single probe.
CREATE INDEX "platform_grant_uses_txid_idx" ON "platform_grant_uses" ("txid");
--> statement-breakpoint
-- Stamped audit rows are queried "everything done under grant G, in order".
CREATE INDEX "audit_log_grant_idx"
	ON "audit_log" ("admin_tenant_session_id", "at")
	WHERE "admin_tenant_session_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "platform_tenant_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_grant_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No FORCE on either: the definer functions read both as the owner. The grant
-- table is readable by the administrator who holds the grant (their own rows);
-- the uses table has no policy at all, so the application sees nothing in it and
-- reaches it only through the definers below.
CREATE POLICY "own_tenant_grants" ON "platform_tenant_grants" FOR SELECT
	USING ("admin_user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- In a split database the application role must not write these tables at all,
-- and must not read the uses table. In an unsplit development database the app
-- owns them and this is skipped; the guarantee holds only where the roles are
-- split, which the invariant test asserts.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname IN ('platform_tenant_grants', 'platform_grant_uses')
		  AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns the grant tables: privilege lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE ALL ON TABLE "platform_grant_uses" FROM campusos_app';
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "platform_tenant_grants" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Is THIS transaction acting under a grant? True only if a use row exists for
-- the current transaction id. A definer, because the application has no read on
-- platform_grant_uses -- which is the point: the answer is a row the caller
-- cannot see, let alone forge or clear.
CREATE OR REPLACE FUNCTION auth_under_tenant_grant()
	RETURNS boolean
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM platform_grant_uses u
		WHERE u.txid = pg_current_xact_id_if_assigned()
	);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_under_tenant_grant() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_under_tenant_grant() TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Who is the administrator behind the grant this transaction is acting under,
-- or NULL if none. The self-elevation check below MUST NOT compare against
-- `app.user_id`: that is a setting the application writes and can re-set to any
-- value mid-transaction, so a comparison to it is forgeable exactly the way
-- property 2 forbids. The acting administrator is instead derived, unforgeably,
-- from the use row for this transaction id through to the grant that owns it.
CREATE OR REPLACE FUNCTION auth_grant_admin_for_txn()
	RETURNS uuid
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT g.admin_user_id
	FROM platform_grant_uses u
	JOIN platform_tenant_grants g ON g.id = u.grant_id
	WHERE u.txid = pg_current_xact_id_if_assigned()
	LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_grant_admin_for_txn() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_grant_admin_for_txn() TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The subtraction. Under a grant the visitor is the tenant's tenant_admin and
-- no more, so the platform-level powers a resident admin lacks are withdrawn,
-- and self-elevation into a permanent membership is refused. RESTRICTIVE, so
-- each ANDs with the permissive tenant/platform policies rather than widening
-- them; keyed on the unforgeable row above.
--
-- platform_roles is absent here on purpose: 0016 already made it unwritable by
-- the application under any context, so there is no permissive write to subtract.
--
-- roles / role_permissions / role_templates / role_template_permissions /
-- tenant_configs / universities all have platform-admin-gated write policies
-- that a grant would otherwise satisfy (the actor is still a platform admin), so
-- each is withdrawn under a grant.
CREATE POLICY "roles_not_under_grant" ON "roles" AS RESTRICTIVE FOR INSERT
	WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "roles_not_under_grant_u" ON "roles" AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "roles_not_under_grant_d" ON "roles" AS RESTRICTIVE FOR DELETE
	USING (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_permissions_not_under_grant" ON "role_permissions" AS RESTRICTIVE FOR INSERT
	WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_permissions_not_under_grant_u" ON "role_permissions" AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_permissions_not_under_grant_d" ON "role_permissions" AS RESTRICTIVE FOR DELETE
	USING (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_templates_not_under_grant" ON "role_templates" AS RESTRICTIVE FOR INSERT
	WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_templates_not_under_grant_u" ON "role_templates" AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_templates_not_under_grant_d" ON "role_templates" AS RESTRICTIVE FOR DELETE
	USING (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_template_permissions_not_under_grant" ON "role_template_permissions"
	AS RESTRICTIVE FOR INSERT WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_template_permissions_not_under_grant_u" ON "role_template_permissions"
	AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "role_template_permissions_not_under_grant_d" ON "role_template_permissions"
	AS RESTRICTIVE FOR DELETE USING (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "tenant_configs_not_under_grant" ON "tenant_configs" AS RESTRICTIVE FOR INSERT
	WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "tenant_configs_not_under_grant_u" ON "tenant_configs" AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "universities_not_under_grant" ON "universities" AS RESTRICTIVE FOR INSERT
	WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
CREATE POLICY "universities_not_under_grant_u" ON "universities" AS RESTRICTIVE FOR UPDATE
	USING (NOT auth_under_tenant_grant()) WITH CHECK (NOT auth_under_tenant_grant());
--> statement-breakpoint
-- Membership and role assignment: permitted under a grant only when it is NOT
-- the visitor promoting themselves. A tenant admin legitimately grants roles to
-- others; a platform visitor writing their own membership is the escalation, and
-- that alone is refused.
-- Self is the grant's own administrator, derived unforgeably from the use row,
-- NOT `app.user_id` (which the application can re-set to dodge the check). A
-- grant visitor may manage other members -- that is what god-mode-as-tenant-
-- admin is for -- but may never write their OWN membership or role, which is the
-- one move that would outlive the grant and need no new grant, no new reason,
-- no new line. `auth_grant_admin_for_txn()` is NULL outside a grant, so the
-- clause is a no-op on every ordinary write.
CREATE POLICY "memberships_no_self_under_grant" ON "tenant_memberships" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn());
--> statement-breakpoint
CREATE POLICY "memberships_no_self_under_grant_u" ON "tenant_memberships" AS RESTRICTIVE FOR UPDATE
	USING ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn())
	WITH CHECK ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn());
--> statement-breakpoint
CREATE POLICY "membership_roles_no_self_under_grant" ON "membership_roles" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn());
--> statement-breakpoint
CREATE POLICY "membership_roles_no_self_under_grant_u" ON "membership_roles" AS RESTRICTIVE FOR UPDATE
	USING ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn())
	WITH CHECK ("user_id" IS DISTINCT FROM auth_grant_admin_for_txn());
--> statement-breakpoint

-- Enter a tenant under an existing open grant, once per transaction. Finds the
-- live grant by the acting user and their session, refuses to layer over a
-- different tenant context, writes the use row (the unforgeable proof), and only
-- then sets app.tenant_id. No secret: the session is the credential, resolved
-- against the database on every request.
CREATE OR REPLACE FUNCTION auth_assume_tenant_grant(p_session_id uuid)
	RETURNS TABLE (grant_id uuid, tenant_id text, expires_at timestamptz, reason text)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
	v_user text := nullif(current_setting('app.user_id', true), '');
	v_current text := nullif(current_setting('app.tenant_id', true), '');
	v_g platform_tenant_grants%ROWTYPE;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	SELECT g.* INTO v_g
	FROM platform_tenant_grants g
	JOIN sessions s ON s.id = g.session_id
	WHERE g.admin_user_id::text = v_user
	  AND g.session_id = p_session_id
	  AND g.revoked_at IS NULL
	  AND g.expires_at > now()
	  AND s.revoked_at IS NULL
	  AND s.expires_at > now();
	IF v_g.id IS NULL THEN
		RAISE EXCEPTION 'no open tenant grant' USING ERRCODE = '42501';
	END IF;
	-- Never run part of a transaction under one tenant and part under another.
	IF v_current IS NOT NULL AND v_current IS DISTINCT FROM v_g.tenant_id THEN
		RAISE EXCEPTION 'a different tenant context is already set' USING ERRCODE = '42501';
	END IF;
	INSERT INTO platform_grant_uses (grant_id, txid)
	VALUES (v_g.id, pg_current_xact_id());
	PERFORM set_config('app.tenant_id', v_g.tenant_id, true);
	RETURN QUERY SELECT v_g.id, v_g.tenant_id, v_g.expires_at, v_g.reason;
END;
$$;
--> statement-breakpoint

-- Open a grant: validate, log, create, enter -- atomically. The audit line is
-- written first so its id anchors the grant's NOT NULL audit_id; if anything
-- fails the whole call rolls back and neither the line nor the grant exists.
CREATE OR REPLACE FUNCTION auth_open_tenant_grant(
	p_tenant_id text,
	p_reason text,
	p_session_id uuid,
	p_minutes integer DEFAULT 30
)
	RETURNS TABLE (grant_id uuid, tenant_id text, expires_at timestamptz, reason text)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
	v_user text := nullif(current_setting('app.user_id', true), '');
	v_uid uuid;
	v_grant_id uuid := gen_random_uuid();
	v_audit_id bigint;
	v_minutes integer := least(greatest(coalesce(p_minutes, 30), 1), 240);
	v_expires timestamptz;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	v_uid := v_user::uuid;
	IF NOT EXISTS (
		SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_uid AND pr.role = 'platform_admin'
	) THEN
		RAISE EXCEPTION 'not a platform administrator' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM sessions s
		WHERE s.id = p_session_id AND s.user_id = v_uid
		  AND s.revoked_at IS NULL AND s.expires_at > now()
	) THEN
		RAISE EXCEPTION 'no live session' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM universities u WHERE u.slug = p_tenant_id) THEN
		RAISE EXCEPTION 'no such tenant' USING ERRCODE = '42704';
	END IF;
	IF p_reason IS NULL OR length(btrim(p_reason)) < 12 THEN
		RAISE EXCEPTION 'a grant needs a reason of at least 12 characters' USING ERRCODE = '22023';
	END IF;
	-- Close any expired-but-unrevoked grant first, with its own line, so the
	-- one-open index never wedges an administrator out of re-entry.
	UPDATE platform_tenant_grants
	   SET revoked_at = now(), revoke_reason = 'expired'
	 WHERE admin_user_id = v_uid AND revoked_at IS NULL AND expires_at <= now();
	IF EXISTS (
		SELECT 1 FROM platform_tenant_grants g
		WHERE g.admin_user_id = v_uid AND g.revoked_at IS NULL AND g.expires_at > now()
	) THEN
		RAISE EXCEPTION 'a tenant grant is already open; close it first' USING ERRCODE = '55006';
	END IF;
	v_expires := now() + make_interval(mins => v_minutes);
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_uid, p_tenant_id, 'platform.tenant_grant_opened', 'tenant_grant', v_grant_id::text,
	        jsonb_build_object('minutes', v_minutes))
	RETURNING id INTO v_audit_id;
	INSERT INTO platform_tenant_grants (
		id, admin_user_id, session_id, tenant_id, reason, opened_at, expires_at, audit_id
	) VALUES (
		v_grant_id, v_uid, p_session_id, p_tenant_id, btrim(p_reason), now(), v_expires, v_audit_id
	);
	PERFORM auth_assume_tenant_grant(p_session_id);
	RETURN QUERY SELECT v_grant_id, p_tenant_id, v_expires, btrim(p_reason);
END;
$$;
--> statement-breakpoint

-- End a grant. The holder closes their own; another platform admin, or a
-- resident administrator of that tenant, may revoke it. The tenant check reads
-- membership directly, NOT auth_effective_permissions, so a grant cannot be the
-- thing that authorises ending a grant.
CREATE OR REPLACE FUNCTION auth_revoke_tenant_grant(p_grant_id uuid, p_reason text DEFAULT NULL)
	RETURNS boolean
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user text := nullif(current_setting('app.user_id', true), '');
	v_uid uuid;
	v_g platform_tenant_grants%ROWTYPE;
	v_action text;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	v_uid := v_user::uuid;
	SELECT g.* INTO v_g FROM platform_tenant_grants g WHERE g.id = p_grant_id;
	IF v_g.id IS NULL OR v_g.revoked_at IS NOT NULL THEN
		RETURN false;
	END IF;
	IF v_g.admin_user_id = v_uid THEN
		v_action := 'platform.tenant_grant_closed';
	ELSIF EXISTS (
		SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_uid AND pr.role = 'platform_admin'
	) THEN
		v_action := 'platform.tenant_grant_revoked';
	ELSIF EXISTS (
		SELECT 1 FROM membership_roles mr
		JOIN tenant_memberships m ON m.id = mr.membership_id
		JOIN roles r ON r.id = mr.role_id
		JOIN role_permissions rp ON rp.role_id = r.id
		WHERE mr.user_id = v_uid AND mr.tenant_id = v_g.tenant_id
		  AND m.status = 'active' AND rp.permission = 'restrict-members'
	) THEN
		v_action := 'platform.tenant_grant_revoked';
	ELSE
		RAISE EXCEPTION 'not yours to end' USING ERRCODE = '42501';
	END IF;
	UPDATE platform_tenant_grants
	   SET revoked_at = now(), revoked_by = v_uid,
	       revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
	 WHERE id = p_grant_id AND revoked_at IS NULL;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_uid, v_g.tenant_id, v_action, 'tenant_grant', p_grant_id::text,
	        jsonb_build_object('admin', v_g.admin_user_id::text));
	RETURN true;
END;
$$;
--> statement-breakpoint

-- A grant takes exactly one write after it is created: its revocation. Nothing
-- may push its expiry back -- extending access is a new grant, a new reason, a
-- new line. This trigger binds the owner too, so even a definer cannot reopen a
-- window; the application cannot UPDATE the table at all (privilege lock above).
CREATE OR REPLACE FUNCTION platform_tenant_grants_close_only()
	RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
	   OR NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id
	   OR NEW.session_id IS DISTINCT FROM OLD.session_id
	   OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
	   OR NEW.reason IS DISTINCT FROM OLD.reason
	   OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
	   OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
	   OR NEW.audit_id IS DISTINCT FROM OLD.audit_id
	   OR OLD.revoked_at IS NOT NULL THEN
		RAISE EXCEPTION 'a tenant grant may only be revoked, once, and never altered';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "platform_tenant_grants_close_only"
	BEFORE UPDATE ON "platform_tenant_grants"
	FOR EACH ROW EXECUTE FUNCTION platform_tenant_grants_close_only();
--> statement-breakpoint

-- Stamp every audit row written inside a granted transaction with the grant it
-- belongs to, derived from the use row for this transaction id. A trigger, so
-- no writer -- including the eight raw-SQL writers and communities_unmask --
-- can forget it, and the caller cannot forge it: the value comes from a table
-- it cannot write. Rows outside a grant are stamped NULL.
CREATE OR REPLACE FUNCTION audit_log_stamp_grant()
	RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
BEGIN
	SELECT u.grant_id INTO NEW.admin_tenant_session_id
	FROM platform_grant_uses u
	WHERE u.txid = pg_current_xact_id_if_assigned()
	LIMIT 1;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_log_grant_stamp" ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER "audit_log_grant_stamp"
	BEFORE INSERT ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_stamp_grant();
--> statement-breakpoint

-- The resolver gains one branch: a platform admin acting under a live grant for
-- THIS transaction resolves to the tenant's own tenant_admin permission set,
-- minus communities.unmask. The ordinary membership branch is unchanged, so a
-- resident member resolves exactly as before, and a platform admin with no use
-- row for this transaction (every existing bare-pool call) resolves to nothing.
CREATE OR REPLACE FUNCTION auth_effective_permissions(p_user_id uuid, p_tenant_id text)
	RETURNS TABLE (permission text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT DISTINCT rp.permission
	FROM membership_roles mr
	JOIN tenant_memberships m ON m.id = mr.membership_id
	JOIN role_permissions rp ON rp.role_id = mr.role_id
	WHERE mr.user_id = p_user_id
	  AND mr.tenant_id = p_tenant_id
	  AND (m.status = 'active' OR (m.standing_until IS NOT NULL AND m.standing_until <= now()))
	UNION
	SELECT DISTINCT rp.permission
	FROM platform_grant_uses u
	JOIN platform_tenant_grants g ON g.id = u.grant_id
	JOIN platform_roles pr ON pr.user_id = g.admin_user_id AND pr.role = 'platform_admin'
	JOIN sessions s ON s.id = g.session_id
	JOIN roles r ON r.tenant_id = g.tenant_id AND r.key = 'tenant_admin' AND r.is_system
	JOIN role_permissions rp ON rp.role_id = r.id
	WHERE u.txid = pg_current_xact_id_if_assigned()
	  AND g.admin_user_id = p_user_id
	  AND g.tenant_id = p_tenant_id
	  AND g.revoked_at IS NULL
	  AND g.expires_at > now()
	  AND s.revoked_at IS NULL
	  AND s.expires_at > now()
	  -- A visitor is narrower than the resident administrator by exactly this.
	  AND rp.permission <> 'communities.unmask';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_effective_permissions(uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- Who has visited this tenant, for its administrators to read. Returns the
-- visitor's handle, never their email. The read surface is wired in 5B; it is
-- defined here so the grant is legible from day one.
CREATE OR REPLACE FUNCTION auth_tenant_grants_for_tenant(p_tenant_id text)
	RETURNS TABLE (
		grant_id uuid, admin_handle text, reason text,
		opened_at timestamptz, expires_at timestamptz, revoked_at timestamptz, uses bigint
	)
	LANGUAGE plpgsql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
	v_user text := nullif(current_setting('app.user_id', true), '');
	v_uid uuid;
BEGIN
	IF v_user IS NULL THEN
		RETURN;
	END IF;
	v_uid := v_user::uuid;
	-- Read directly from membership, not through the grant-aware resolver, so
	-- this listing cannot be reached by way of a grant into the tenant.
	IF NOT EXISTS (
		SELECT 1 FROM membership_roles mr
		JOIN tenant_memberships m ON m.id = mr.membership_id
		JOIN roles r ON r.id = mr.role_id
		JOIN role_permissions rp ON rp.role_id = r.id
		WHERE mr.user_id = v_uid AND mr.tenant_id = p_tenant_id
		  AND m.status = 'active' AND rp.permission = 'restrict-members'
	) THEN
		RETURN;
	END IF;
	RETURN QUERY
	SELECT g.id, usr.handle, g.reason, g.opened_at, g.expires_at, g.revoked_at,
	       (SELECT count(*) FROM platform_grant_uses x WHERE x.grant_id = g.id)
	FROM platform_tenant_grants g
	JOIN users usr ON usr.id = g.admin_user_id
	WHERE g.tenant_id = p_tenant_id
	ORDER BY g.opened_at DESC;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_open_tenant_grant(text, text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_assume_tenant_grant(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_revoke_tenant_grant(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_tenant_grants_for_tenant(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_effective_permissions(uuid, text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_open_tenant_grant(text, text, uuid, integer) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_assume_tenant_grant(uuid) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_revoke_tenant_grant(uuid, text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_tenant_grants_for_tenant(text) TO campusos_app';
	END IF;
END
$$;
