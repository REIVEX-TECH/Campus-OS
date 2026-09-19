-- Which contextual home cards a person has dismissed, and when.
--
-- A contextual card is a small, time-decayed nudge on the tenant home (post to
-- Lost & Found, a module just launched). It is dismissible per card per person, and
-- once dismissed it does not return for 24 hours -- so this remembers the dismissal
-- with its time, keyed on (user, tenant, card). The 24h window is applied on read
-- (dismissed_at > now() - interval), and a re-dismiss restarts it (ON CONFLICT sets
-- dismissed_at = now()); nothing here needs cleanup.
--
-- Per account, not per device, exactly like verify_prompt_dismissed (0027): the
-- person's own low-stakes preference, not a privilege, so the application writes and
-- reads it directly under RLS that keys on app.user_id. card_id is an opaque string
-- (the catalog lives in the web app); identity stays agnostic of what cards exist.
CREATE TABLE "card_dismissals" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"card_id" text NOT NULL,
	"dismissed_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "tenant_id", "card_id")
);
--> statement-breakpoint
ALTER TABLE "card_dismissals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "card_dismissals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_card_dismissals" ON "card_dismissals"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
