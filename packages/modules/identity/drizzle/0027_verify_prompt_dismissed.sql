-- Whether a person has dismissed the "get verified" prompt for a university.
--
-- Per account, not per device: one dismissal anywhere is remembered everywhere,
-- so the gentle prompt never nags a second time. It is the person's own low-stakes
-- preference (like user_recents), not a privilege, so the application writes and
-- reads it directly under RLS that keys on app.user_id: theirs to set, theirs to
-- read, and nobody else's to see or change. Once verified the prompt is not shown
-- regardless of this row, so it needs no cleanup.
CREATE TABLE "verify_prompt_dismissed" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"dismissed_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "tenant_id")
);
--> statement-breakpoint
ALTER TABLE "verify_prompt_dismissed" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verify_prompt_dismissed" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_verify_prompt_dismissed" ON "verify_prompt_dismissed"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
