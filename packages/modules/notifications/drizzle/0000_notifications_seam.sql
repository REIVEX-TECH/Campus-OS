-- The notifications seam: this module takes ownership of the shared `notifications`
-- table and generalises it so any module can emit, not just communities.
--
-- The table was created by communities 0002 (recipient's own rows, written by a
-- SECURITY DEFINER because the recipient is an author the app cannot read; tenant
-- isolation + a RESTRICTIVE own-row policy; the app has SELECT/UPDATE/DELETE on its
-- own rows but NO INSERT). This migration is DDL only -- it adds a generic
-- `payload` and `link`, relaxes `community_id` to nullable so a non-communities
-- notification needs none, and adds the generic `notifications_emit` definer. It
-- changes no existing row: communities notifications keep their columns and their
-- communities_notify path untouched; every other module emits generic rows through
-- the definer below. RLS is unchanged (still tenant isolation + own-row); this
-- module now owns future changes to the table.
--
-- This runs after communities in migrate-all (it ALTERs a table communities
-- creates). §6: the definer inserts under the caller's tenant (from the GUC, the
-- isolation key), for an explicit recipient the caller legitimately holds; a
-- notification is data, not a privilege, and the recipient reads it under the
-- own-row policy. The app still cannot INSERT directly -- only this definer writes.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "payload" jsonb;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link" text;
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "community_id" DROP NOT NULL;
--> statement-breakpoint

-- Emit a generic notification. The recipient, kind, an optional display payload and
-- an optional in-app link are the caller's; the tenant is the caller's context, not
-- an argument, so a row can only ever land in the caller's own tenant. Nothing is
-- written when the actor is the recipient (you are not told of your own action) or
-- when there is no recipient. Returns the new row id, or null when skipped.
CREATE OR REPLACE FUNCTION notifications_emit(
	p_user uuid, p_kind text, p_payload jsonb, p_link text, p_actor uuid
)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_tenant text := nullif(current_setting('app.tenant_id', true), '');
	v_id uuid;
BEGIN
	IF v_tenant IS NULL THEN
		RAISE EXCEPTION 'notifications_emit: no tenant' USING ERRCODE = '42501';
	END IF;
	IF p_user IS NULL THEN
		RAISE EXCEPTION 'notifications_emit: no recipient' USING ERRCODE = '22023';
	END IF;
	IF p_actor IS NOT NULL AND p_actor = p_user THEN
		RETURN NULL;
	END IF;
	INSERT INTO notifications (tenant_id, user_id, kind, actor_id, payload, link)
	VALUES (v_tenant, p_user, p_kind, p_actor, p_payload, nullif(p_link, ''))
	RETURNING id INTO v_id;
	RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications_emit(uuid, text, jsonb, text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION notifications_emit(uuid, text, jsonb, text, uuid) TO campusos_app';
	END IF;
END
$$;
