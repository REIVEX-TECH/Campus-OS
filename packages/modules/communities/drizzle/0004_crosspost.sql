-- Crossposts: a post that points at another post in the same tenant. The
-- pointer rides on posts and shows through the read view, appended at the
-- end, which is what OR REPLACE allows. The source is resolved by the reader
-- in one batched query; a deleted source leaves a crosspost that says so.
ALTER TABLE "posts" ADD COLUMN "crosspost_of" uuid REFERENCES "posts"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "posts_crosspost_idx" ON "posts" ("crosspost_of") WHERE "crosspost_of" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE VIEW "posts_read" AS
	SELECT p.id, p.tenant_id, p.community_id, p.public_author_id, p.kind, p.title, p.body,
	       p.url, p.url_domain, p.is_anonymous, p.spoiler, p.flair_id, p.pinned_at, p.locked_at,
	       p.removed_at, p.removal_reason, p.deleted_at, p.edited_at, p.up_votes, p.down_votes,
	       p.score, p.hot_score, p.controversy, p.comment_count, p.created_at,
	       (p.author_id::text = current_setting('app.user_id', true)) AS is_own,
	       p.poll_closes_at,
	       p.crosspost_of
	FROM posts p;
