-- Rides: ride offers and ride requests, as posts.
--
-- One table holds two kinds. An offer carries a seat ledger (seats_total /
-- seats_available); a request is a want-ad with no ledger. Both are the author's
-- own content, so creation is a normal application insert guarded by a RESTRICTIVE
-- insert-as-self policy (the posts pattern, exactly like lf_items and communities
-- posts). Editing and cancelling run under the tenant policy plus an application
-- ownership check in the write path; seat requests, ratings, reports and their
-- tighter, non-tenant-wide RLS arrive in later migrations.
--
-- No gender is stored anywhere: women_only is a label the author sets on a ride
-- and a browse filter, self-declared and unverified (see docs/design-rides.md).
-- author_id references users; tenant_id references the tenant slug. A recurring
-- offer keeps a recurrence descriptor (wall-clock time + ISO weekdays) and each
-- spawned occurrence points at its parent, so the sweep can compute the next
-- depart_at through the tenant timezone (CLAUDE.md §5) without drift.

CREATE TABLE "ride_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"origin_text" text NOT NULL,
	"dest_text" text NOT NULL,
	"origin_lat" double precision,
	"origin_lng" double precision,
	"dest_lat" double precision,
	"dest_lng" double precision,
	"depart_at" timestamptz NOT NULL,
	"seats_total" integer,
	"seats_available" integer,
	"notes" text NOT NULL DEFAULT '',
	"women_only" boolean NOT NULL DEFAULT false,
	"status" text NOT NULL DEFAULT 'active',
	"recurrence" jsonb,
	"recurrence_parent_id" uuid REFERENCES "ride_posts"("id") ON DELETE SET NULL,
	"cancelled_at" timestamptz,
	"completed_at" timestamptz,
	"edited_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "ride_posts_kind_ck" CHECK ("kind" IN ('offer', 'request')),
	CONSTRAINT "ride_posts_status_ck"
		CHECK ("status" IN ('active', 'full', 'completed', 'cancelled', 'expired')),
	-- An offer has a seat ledger; a request does not. Seats never go negative.
	CONSTRAINT "ride_posts_offer_seats_ck" CHECK (
		("kind" = 'offer' AND "seats_total" IS NOT NULL AND "seats_available" IS NOT NULL
			AND "seats_total" > 0 AND "seats_available" >= 0 AND "seats_available" <= "seats_total")
		OR ("kind" = 'request' AND "seats_total" IS NULL AND "seats_available" IS NULL)
	)
);
--> statement-breakpoint
CREATE INDEX "ride_posts_browse_idx" ON "ride_posts" ("tenant_id", "status", "depart_at", "id");
--> statement-breakpoint
CREATE INDEX "ride_posts_author_idx" ON "ride_posts" ("tenant_id", "author_id", "created_at");
--> statement-breakpoint
-- Recurrence spawn is idempotent: one occurrence per (parent, departure).
CREATE UNIQUE INDEX "ride_posts_occurrence_uq" ON "ride_posts" ("recurrence_parent_id", "depart_at")
	WHERE "recurrence_parent_id" IS NOT NULL;
--> statement-breakpoint

-- RLS: tenant isolation, FORCE. A ride board is tenant-wide readable (browse);
-- the browse query, not the policy, filters which statuses appear. No owner-run
-- definer reads this table yet, so FORCE stays on. The application role is a
-- non-owner and is bound by these policies regardless.
ALTER TABLE "ride_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ride_posts"
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "ride_posts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A ride is created only as oneself; edits and cancels run under the tenant policy
-- plus the write path's ownership check (author_id in the WHERE), the posts pattern.
CREATE POLICY "ride_posts_author_is_self" ON "ride_posts" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("author_id"::text = current_setting('app.user_id', true));
