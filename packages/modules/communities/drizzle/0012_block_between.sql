-- A caller-scoped, bidirectional block check, for cross-module composition.
--
-- `user_blocks` reads are own-row under RLS (blocker_id = app.user_id, 0000), so a
-- caller can see whether THEY blocked someone but not whether that someone blocked
-- THEM. Direct messages needs both directions to refuse a request or a send when
-- either party has blocked the other (CLAUDE.md: a module composes another's
-- capability, it does not read its tables).
--
-- This owner-run definer answers ONLY "is the current actor in a block
-- relationship with p_other, in either direction?". The actor is always one side
-- of the pair, so it never discloses a third party's blocks; the single new fact
-- it yields is "this person blocked you", which is exactly the fact the refusal is
-- built on. It reads nothing else and writes nothing.
--
-- user_blocks was FORCE (0000), which binds the owner too, so the definer -- run as
-- the owner -- would still be filtered by the own-row policy and never see the
-- reverse block. Drop FORCE so the owner (this definer, and migrations) reads
-- across; the application role is a non-owner and stays fully bound by RLS (the
-- RESTRICTIVE own-row policy and the permissive tenant policy are unchanged), so no
-- app-facing read or write widens. This is the same NO-FORCE-for-a-definer-read
-- pattern the moderation and identity tables use.
ALTER TABLE "user_blocks" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_blocked_between(p_tenant_id text, p_other uuid)
	RETURNS boolean
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM user_blocks b
		WHERE b.tenant_id = p_tenant_id
		  AND (
			(b.blocker_id::text = current_setting('app.user_id', true) AND b.blocked_id = p_other)
			OR (b.blocker_id = p_other AND b.blocked_id::text = current_setting('app.user_id', true))
		  )
	);
$$;
--> statement-breakpoint
-- Owner default privileges would grant EXECUTE to the app role; this function is
-- app-callable on purpose (it self-scopes to the caller), so the grant stays. The
-- REVOKE-then-GRANT keeps it explicit and symmetric with the other definers.
REVOKE ALL ON FUNCTION auth_blocked_between(text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_blocked_between(text, uuid) TO campusos_app';
	END IF;
END
$$;
