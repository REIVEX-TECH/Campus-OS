-- Communities: the tables, their isolation, and the anonymity model.
--
-- Every table carries tenant_id and is under RLS with the ordinary tenant
-- policy. FORCE is on everywhere except the three tables the definer function
-- below reads (memberships, member roles, bans), for the reason recorded in the
-- identity migrations: a SECURITY DEFINER function cannot read a table with
-- FORCE. The invariant test in this module pins the state of each.
--
-- The anonymity of an anonymous post is enforced here, not in code that reads:
-- the application role cannot select posts.author_id or comments.author_id at
-- all. Reads go through posts_read and comments_read, owned by the schema
-- owner, which expose is_own and the generated public_author_id (null when
-- anonymous). Writes still name the author, and a restrictive policy makes
-- sure it is the caller. The one way to learn an anonymous author is
-- communities_unmask, which requires an explicit permission and an open report
-- and writes its audit line in the same transaction, or returns nothing.
--
-- References to users and roles are foreign keys to the identity module's
-- tables; that module's migrations run before this one.

CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_seed" text NOT NULL,
	"banner_seed" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"allowed_kinds" text[] DEFAULT '{text,link}'::text[] NOT NULL,
	"approval_status" text DEFAULT 'approved' NOT NULL,
	"mod_log_public" boolean DEFAULT false NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamptz,
	"created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "communities_tenant_slug_uq" ON "communities" ("tenant_id", "slug");
--> statement-breakpoint

CREATE TABLE "community_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "community_rules_community_idx" ON "community_rules" ("community_id", "position");
--> statement-breakpoint

CREATE TABLE "community_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"joined_at" timestamptz DEFAULT now() NOT NULL,
	"left_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "community_memberships_community_user_uq" ON "community_memberships" ("community_id", "user_id");
--> statement-breakpoint
CREATE INDEX "community_memberships_user_idx" ON "community_memberships" ("tenant_id", "user_id");
--> statement-breakpoint

CREATE TABLE "community_member_roles" (
	"membership_id" uuid NOT NULL REFERENCES "community_memberships"("id") ON DELETE CASCADE,
	"role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_at" timestamptz DEFAULT now() NOT NULL,
	"granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	PRIMARY KEY ("membership_id", "role_id")
);
--> statement-breakpoint
CREATE INDEX "community_member_roles_user_idx" ON "community_member_roles" ("tenant_id", "user_id", "community_id");
--> statement-breakpoint

CREATE TABLE "community_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid REFERENCES "communities"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"until" timestamptz,
	"created_by" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"lifted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "community_bans_user_idx" ON "community_bans" ("tenant_id", "user_id", "community_id");
--> statement-breakpoint

CREATE TABLE "community_mutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"until" timestamptz,
	"created_by" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"lifted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "community_mutes_user_idx" ON "community_mutes" ("tenant_id", "user_id", "community_id");
--> statement-breakpoint

CREATE TABLE "user_blocks" (
	"tenant_id" text NOT NULL,
	"blocker_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"blocked_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("tenant_id", "blocker_id", "blocked_id")
);
--> statement-breakpoint

CREATE TABLE "post_flairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "post_flairs_community_idx" ON "post_flairs" ("community_id", "position");
--> statement-breakpoint

CREATE TABLE "user_flairs" (
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"text" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	PRIMARY KEY ("community_id", "user_id")
);
--> statement-breakpoint

CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
	"public_author_id" uuid GENERATED ALWAYS AS (CASE WHEN "is_anonymous" THEN NULL ELSE "author_id" END) STORED,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"url_domain" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"spoiler" boolean DEFAULT false NOT NULL,
	"flair_id" uuid REFERENCES "post_flairs"("id") ON DELETE SET NULL,
	"pinned_at" timestamptz,
	"pinned_by" uuid,
	"locked_at" timestamptz,
	"locked_by" uuid,
	"removed_at" timestamptz,
	"removed_by" uuid,
	"removal_reason" text,
	"deleted_at" timestamptz,
	"edited_at" timestamptz,
	"up_votes" integer DEFAULT 0 NOT NULL,
	"down_votes" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"hot_score" numeric(20, 7) DEFAULT 0 NOT NULL,
	"controversy" numeric(20, 7) DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "posts_feed_hot_idx" ON "posts" ("tenant_id", "community_id", "hot_score" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "posts_feed_new_idx" ON "posts" ("tenant_id", "community_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "posts_feed_top_idx" ON "posts" ("tenant_id", "community_id", "score" DESC, "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "posts_all_hot_idx" ON "posts" ("tenant_id", "hot_score" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "posts_all_new_idx" ON "posts" ("tenant_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
-- Public profile history: the partial index means the query behind a profile
-- page cannot touch an anonymous row even by accident.
CREATE INDEX "posts_profile_idx" ON "posts" ("tenant_id", "public_author_id", "created_at" DESC) WHERE "public_author_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "posts_url_idx" ON "posts" ("tenant_id", "community_id", "url");
--> statement-breakpoint

CREATE TABLE "post_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
	"edited_at" timestamptz DEFAULT now() NOT NULL,
	"previous_title" text NOT NULL,
	"previous_body" text
);
--> statement-breakpoint

CREATE TABLE "post_votes" (
	"tenant_id" text NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"value" integer NOT NULL CHECK ("value" IN (-1, 1)),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("post_id", "user_id")
);
--> statement-breakpoint

CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
	"parent_id" uuid REFERENCES "comments"("id") ON DELETE CASCADE,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
	"public_author_id" uuid GENERATED ALWAYS AS (CASE WHEN "is_anonymous" THEN NULL ELSE "author_id" END) STORED,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"removed_at" timestamptz,
	"removed_by" uuid,
	"removal_reason" text,
	"deleted_at" timestamptz,
	"edited_at" timestamptz,
	"up_votes" integer DEFAULT 0 NOT NULL,
	"down_votes" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"best_score" numeric(12, 7) DEFAULT 0 NOT NULL,
	"controversy" numeric(20, 7) DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comments_post_path_idx" ON "comments" ("post_id", "path");
--> statement-breakpoint
CREATE INDEX "comments_profile_idx" ON "comments" ("tenant_id", "public_author_id", "created_at" DESC) WHERE "public_author_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "comment_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"comment_id" uuid NOT NULL REFERENCES "comments"("id") ON DELETE CASCADE,
	"edited_at" timestamptz DEFAULT now() NOT NULL,
	"previous_body" text NOT NULL
);
--> statement-breakpoint

CREATE TABLE "comment_votes" (
	"tenant_id" text NOT NULL,
	"comment_id" uuid NOT NULL REFERENCES "comments"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"value" integer NOT NULL CHECK ("value" IN (-1, 1)),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("comment_id", "user_id")
);
--> statement-breakpoint

CREATE TABLE "saved_items" (
	"tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "item_type", "item_id")
);
--> statement-breakpoint

CREATE TABLE "hidden_items" (
	"tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "item_type", "item_id")
);
--> statement-breakpoint

CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamptz,
	"resolution" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reports_item_reporter_uq" ON "reports" ("item_type", "item_id", "reporter_id");
--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" ("tenant_id", "community_id", "status", "created_at" DESC);
--> statement-breakpoint

CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "moderation_actions_community_idx" ON "moderation_actions" ("community_id", "created_at" DESC);
--> statement-breakpoint

CREATE TABLE "automod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"community_id" uuid NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"action" text DEFAULT 'queue' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "automod_rules_community_idx" ON "automod_rules" ("community_id");
--> statement-breakpoint

-- Row security. One tenant policy per table; FORCE everywhere except the three
-- tables the definer function reads.
DO $$
DECLARE
	t text;
	forced text[] := ARRAY[
		'communities', 'community_rules', 'community_mutes', 'user_blocks',
		'post_flairs', 'user_flairs', 'posts', 'post_edits', 'post_votes',
		'comments', 'comment_edits', 'comment_votes', 'saved_items', 'hidden_items',
		'reports', 'moderation_actions', 'automod_rules'
	];
	unforced text[] := ARRAY['community_memberships', 'community_member_roles', 'community_bans'];
BEGIN
	FOREACH t IN ARRAY forced || unforced LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
			t
		);
	END LOOP;
	FOREACH t IN ARRAY forced LOOP
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
	END LOOP;
END
$$;
--> statement-breakpoint

-- Restrictive policies: a person writes only as themselves. These AND with the
-- tenant policy rather than OR with it.
CREATE POLICY "posts_author_is_self" ON "posts" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("author_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "comments_author_is_self" ON "comments" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("author_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "post_votes_own" ON "post_votes" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "comment_votes_own" ON "comment_votes" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "saved_items_own" ON "saved_items" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "hidden_items_own" ON "hidden_items" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "user_blocks_own" ON "user_blocks" AS RESTRICTIVE
	USING ("blocker_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("blocker_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
CREATE POLICY "reports_reporter_is_self" ON "reports" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("reporter_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- The read views. Owned by whoever runs this migration (the schema owner in a
-- split database), so RLS on the tables applies to the owner through FORCE with
-- the caller's transaction context. is_own is the one thing the view knows that
-- the caller may not learn directly.
CREATE OR REPLACE VIEW "posts_read" AS
	SELECT p.id, p.tenant_id, p.community_id, p.public_author_id, p.kind, p.title, p.body,
	       p.url, p.url_domain, p.is_anonymous, p.spoiler, p.flair_id, p.pinned_at, p.locked_at,
	       p.removed_at, p.removal_reason, p.deleted_at, p.edited_at, p.up_votes, p.down_votes,
	       p.score, p.hot_score, p.controversy, p.comment_count, p.created_at,
	       (p.author_id::text = current_setting('app.user_id', true)) AS is_own
	FROM posts p;
--> statement-breakpoint
CREATE OR REPLACE VIEW "comments_read" AS
	SELECT c.id, c.tenant_id, c.post_id, c.parent_id, c.path, c.depth, c.public_author_id,
	       c.is_anonymous, c.body, c.removed_at, c.removal_reason, c.deleted_at, c.edited_at,
	       c.up_votes, c.down_votes, c.score, c.best_score, c.controversy, c.created_at,
	       (c.author_id::text = current_setting('app.user_id', true)) AS is_own
	FROM comments c;
--> statement-breakpoint

-- Column privileges. A table level SELECT would make a column level REVOKE a
-- no-op, so the table grant is removed and every column but author_id granted
-- back. A later migration that adds a column to posts or comments must add it
-- here too, or the application will not see it.
DO $$
BEGIN
	-- Only in a split database: where the application role still owns the
	-- tables (an unsplit development database) revoking its SELECT would break
	-- the views it also owns, and the guarantee cannot hold there anyway.
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'posts' AND relkind = 'r') <> 'campusos_app' THEN
		EXECUTE 'REVOKE SELECT ON posts FROM campusos_app';
		EXECUTE 'GRANT SELECT (id, tenant_id, community_id, public_author_id, kind, title, body, url, url_domain, is_anonymous, spoiler, flair_id, pinned_at, pinned_by, locked_at, locked_by, removed_at, removed_by, removal_reason, deleted_at, edited_at, up_votes, down_votes, score, hot_score, controversy, comment_count, created_at) ON posts TO campusos_app';
		EXECUTE 'REVOKE SELECT ON comments FROM campusos_app';
		EXECUTE 'GRANT SELECT (id, tenant_id, post_id, parent_id, path, depth, public_author_id, is_anonymous, body, removed_at, removed_by, removal_reason, deleted_at, edited_at, up_votes, down_votes, score, best_score, controversy, created_at) ON comments TO campusos_app';
		EXECUTE 'GRANT SELECT ON posts_read TO campusos_app';
		EXECUTE 'GRANT SELECT ON comments_read TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- What may this person do in this community: the tenant wide set, plus the
-- roles they hold here, and nothing at all while banned here or tenant wide,
-- while their community membership has ended, or while their tenant membership
-- is not active.
CREATE OR REPLACE FUNCTION auth_effective_community_permissions(p_user_id uuid, p_tenant_id text, p_community_id uuid)
	RETURNS TABLE (permission text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	WITH banned AS (
		SELECT 1
		FROM community_bans b
		WHERE b.user_id = p_user_id
		  AND b.tenant_id = p_tenant_id
		  AND (b.community_id = p_community_id OR b.community_id IS NULL)
		  AND b.lifted_at IS NULL
		  AND (b.until IS NULL OR b.until > now())
	)
	SELECT permission FROM auth_effective_permissions(p_user_id, p_tenant_id)
	WHERE NOT EXISTS (SELECT 1 FROM banned)
	UNION
	SELECT rp.permission
	FROM community_memberships cm
	JOIN community_member_roles cmr ON cmr.membership_id = cm.id
	JOIN role_permissions rp ON rp.role_id = cmr.role_id
	JOIN tenant_memberships tm ON tm.user_id = cm.user_id AND tm.tenant_id = cm.tenant_id
	WHERE cm.user_id = p_user_id
	  AND cm.tenant_id = p_tenant_id
	  AND cm.community_id = p_community_id
	  AND cm.left_at IS NULL
	  AND tm.status = 'active'
	  AND NOT EXISTS (SELECT 1 FROM banned);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_effective_community_permissions(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_effective_community_permissions(uuid, text, uuid) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The one way to learn an anonymous author. Requires the caller (app.user_id in
-- the tenant app.tenant_id) to hold communities.unmask there, and an OPEN report
-- naming the item. Writes the audit line first, in the caller's transaction, so
-- an unmask that is not logged cannot happen: if the insert fails, nothing is
-- returned. Raises on refusal so a caller cannot mistake silence for a result;
-- call it in its own transaction.
CREATE OR REPLACE FUNCTION communities_unmask(p_item_type text, p_item_id uuid, p_report_id uuid)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_tenant text := nullif(current_setting('app.tenant_id', true), '');
	v_author uuid;
BEGIN
	IF v_user IS NULL OR v_tenant IS NULL THEN
		RAISE EXCEPTION 'communities_unmask: no actor' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM auth_effective_permissions(v_user, v_tenant) WHERE permission = 'communities.unmask'
	) THEN
		RAISE EXCEPTION 'communities_unmask: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM reports r
		WHERE r.id = p_report_id AND r.tenant_id = v_tenant
		  AND r.item_type = p_item_type AND r.item_id = p_item_id AND r.status = 'open'
	) THEN
		RAISE EXCEPTION 'communities_unmask: no open report names this item' USING ERRCODE = '42501';
	END IF;
	IF p_item_type = 'post' THEN
		SELECT author_id INTO v_author FROM posts WHERE id = p_item_id AND tenant_id = v_tenant;
	ELSIF p_item_type = 'comment' THEN
		SELECT author_id INTO v_author FROM comments WHERE id = p_item_id AND tenant_id = v_tenant;
	ELSE
		RAISE EXCEPTION 'communities_unmask: unknown item type' USING ERRCODE = '22023';
	END IF;
	IF v_author IS NULL THEN
		RAISE EXCEPTION 'communities_unmask: no such item' USING ERRCODE = '42501';
	END IF;
	INSERT INTO audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
	VALUES (v_user, v_tenant, 'communities.unmasked', p_item_type, p_item_id::text,
	        jsonb_build_object('reportId', p_report_id, 'unmaskedUserId', v_author));
	RETURN v_author;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION communities_unmask(text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION communities_unmask(text, uuid, uuid) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The community roles, for every tenant that already exists, and the new
-- tenant level permissions on the roles that hold them. New tenants get the
-- same through ensureSystemRoles (core's catalogue) and ensureCommunityRoles.
-- Idempotent.
INSERT INTO "roles" ("tenant_id", "key", "name", "is_system")
SELECT u.slug, r.key, r.name, true
FROM "universities" u
CROSS JOIN (VALUES
	('community_member', 'Member'),
	('community_moderator', 'Moderator'),
	('community_owner', 'Owner')
) AS r(key, name)
ON CONFLICT ("tenant_id", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission")
SELECT r.id, r.tenant_id, p.permission
FROM "roles" r
JOIN (VALUES
	('community_member', 'communities.post'),
	('community_member', 'communities.comment'),
	('community_member', 'communities.vote'),
	('community_moderator', 'communities.post'),
	('community_moderator', 'communities.comment'),
	('community_moderator', 'communities.vote'),
	('community_moderator', 'communities.moderate'),
	('community_moderator', 'communities.flairs'),
	('community_owner', 'communities.post'),
	('community_owner', 'communities.comment'),
	('community_owner', 'communities.vote'),
	('community_owner', 'communities.moderate'),
	('community_owner', 'communities.flairs'),
	('community_owner', 'communities.manage'),
	('community_owner', 'communities.transfer'),
	('student', 'communities.create'),
	('teacher', 'communities.create'),
	('tenant_admin', 'communities.create'),
	('tenant_admin', 'communities.oversee'),
	('tenant_admin', 'communities.post'),
	('tenant_admin', 'communities.comment'),
	('tenant_admin', 'communities.vote'),
	('tenant_admin', 'communities.moderate'),
	('tenant_admin', 'communities.flairs'),
	('tenant_admin', 'communities.manage'),
	('tenant_admin', 'communities.transfer')
) AS p(role_key, permission) ON p.role_key = r.key
WHERE r.is_system
ON CONFLICT ("role_id", "permission") DO NOTHING;
