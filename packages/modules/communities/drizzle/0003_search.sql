-- Search: expression indexes, no new columns. The query side builds the same
-- expression over posts_read (the view inlines to the table, so the planner
-- matches it) and over communities. 'simple' keeps it language neutral; a
-- campus writes in more than one.
CREATE INDEX "posts_search_idx" ON "posts"
	USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("body", '')));
--> statement-breakpoint
CREATE INDEX "communities_search_idx" ON "communities"
	USING gin (to_tsvector('simple', "name" || ' ' || coalesce("description", '')));
