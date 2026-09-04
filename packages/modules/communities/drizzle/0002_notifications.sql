-- In-app notifications. A row belongs to its recipient: the app role reads and
-- updates its own rows only (restrictive policy). Rows are written by a
-- SECURITY DEFINER function, because the recipient of "someone commented on
-- your post" is an author the app role cannot read; so this table, like the
-- others a definer function touches, is not FORCED. The function never writes
-- the actor when the triggering item is anonymous.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE cascade,
	"post_id" uuid REFERENCES "posts"("id") ON DELETE cascade,
	"comment_id" uuid REFERENCES "comments"("id") ON DELETE cascade,
	"read_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" ("tenant_id", "user_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" ("tenant_id", "user_id") WHERE "read_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications"
	USING (tenant_id = current_setting('app.tenant_id', true))
	WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE POLICY "notifications_own" ON "notifications" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON "notifications" TO campusos_app;
--> statement-breakpoint
-- Tell an author something happened to their item. The recipient is looked up
-- here, never returned; the caller learns nothing. Nothing is written when the
-- actor is the recipient, or when there is no recipient.
CREATE OR REPLACE FUNCTION communities_notify(
	p_kind text, p_post_id uuid, p_comment_id uuid, p_actor uuid, p_actor_public boolean
)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_tenant text := nullif(current_setting('app.tenant_id', true), '');
	v_recipient uuid;
	v_community uuid;
BEGIN
	IF v_tenant IS NULL THEN
		RAISE EXCEPTION 'communities_notify: no tenant' USING ERRCODE = '42501';
	END IF;
	SELECT community_id INTO v_community FROM posts WHERE id = p_post_id AND tenant_id = v_tenant;
	IF v_community IS NULL THEN
		RETURN;
	END IF;
	IF p_kind IN ('comment_on_post', 'post_removed') THEN
		SELECT author_id INTO v_recipient FROM posts WHERE id = p_post_id AND tenant_id = v_tenant;
	ELSIF p_kind = 'reply' THEN
		SELECT parent.author_id INTO v_recipient
		FROM comments c JOIN comments parent ON parent.id = c.parent_id
		WHERE c.id = p_comment_id AND c.tenant_id = v_tenant;
	ELSIF p_kind = 'comment_removed' THEN
		SELECT author_id INTO v_recipient FROM comments WHERE id = p_comment_id AND tenant_id = v_tenant;
	ELSE
		RAISE EXCEPTION 'communities_notify: unknown kind' USING ERRCODE = '22023';
	END IF;
	IF v_recipient IS NULL OR v_recipient = p_actor THEN
		RETURN;
	END IF;
	INSERT INTO notifications (tenant_id, user_id, kind, actor_id, community_id, post_id, comment_id)
	VALUES (v_tenant, v_recipient, p_kind,
	        CASE WHEN p_actor_public THEN p_actor ELSE NULL END,
	        v_community, p_post_id, p_comment_id);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION communities_notify(text, uuid, uuid, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION communities_notify(text, uuid, uuid, uuid, boolean) TO campusos_app';
	END IF;
END
$$;
