-- Polls: a post kind with options and a closing time. Options carry the counts;
-- who chose what lives in poll_votes under an own row policy, so a vote is the
-- voter's alone to read. Both tables take the same tenant policy and FORCE as
-- the rest of the module; nothing here is read by a definer function.
ALTER TABLE "posts" ADD COLUMN "poll_closes_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "communities" ALTER COLUMN "allowed_kinds" SET DEFAULT '{text,link,poll}'::text[];
--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "poll_options_post_idx" ON "poll_options" ("post_id", "position");
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"tenant_id" text NOT NULL,
	"post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
	"option_id" uuid NOT NULL REFERENCES "poll_options"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("post_id", "user_id")
);
--> statement-breakpoint
DO $$
DECLARE
	t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['poll_options', 'poll_votes'] LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
			t
		);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
	END LOOP;
END
$$;
--> statement-breakpoint
CREATE POLICY "poll_votes_own" ON "poll_votes" AS RESTRICTIVE
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "poll_options", "poll_votes" TO campusos_app;
--> statement-breakpoint
-- The read view gains the closing time at the end, which is what OR REPLACE allows.
CREATE OR REPLACE VIEW "posts_read" AS
	SELECT p.id, p.tenant_id, p.community_id, p.public_author_id, p.kind, p.title, p.body,
	       p.url, p.url_domain, p.is_anonymous, p.spoiler, p.flair_id, p.pinned_at, p.locked_at,
	       p.removed_at, p.removal_reason, p.deleted_at, p.edited_at, p.up_votes, p.down_votes,
	       p.score, p.hot_score, p.controversy, p.comment_count, p.created_at,
	       (p.author_id::text = current_setting('app.user_id', true)) AS is_own,
	       p.poll_closes_at
	FROM posts p;
