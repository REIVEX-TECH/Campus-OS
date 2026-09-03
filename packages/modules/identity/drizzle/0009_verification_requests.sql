-- Verification requests: how someone off the university's email domain asks to
-- be recognised, and how a tenant admin answers.
--
-- The details a person submits (name, roll number, note) exist only to let an
-- admin check them against the university's own records. They are PURGED the
-- moment a decision is made; what remains is the status and the timestamps,
-- which is what rate limiting and the audit trail need. Rows are never deleted.
CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"status" text DEFAULT 'pending' NOT NULL,
	"full_name" text,
	"roll_number" text,
	"note" text,
	"decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"decided_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verification_requests_tenant_status_idx" ON "verification_requests" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "verification_requests_user_idx" ON "verification_requests" ("user_id", "created_at");
--> statement-breakpoint
-- One open request per person per tenant, enforced where it cannot race.
CREATE UNIQUE INDEX "verification_requests_one_open_uq" ON "verification_requests" ("tenant_id", "user_id") WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "verification_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Reading: your own requests, or every request in the tenant you are acting in.
CREATE POLICY "requests_read" ON "verification_requests" FOR SELECT
	USING (
		"user_id"::text = current_setting('app.user_id', true)
		OR "tenant_id" = current_setting('app.tenant_id', true)
	);
--> statement-breakpoint
-- Creating: only your own, only as pending, only undecided. A person can ask;
-- they cannot answer.
CREATE POLICY "requests_insert" ON "verification_requests" FOR INSERT
	WITH CHECK (
		"user_id"::text = current_setting('app.user_id', true)
		AND "status" = 'pending'
		AND "decided_by" IS NULL
		AND "decided_at" IS NULL
	);
--> statement-breakpoint
-- Answering: only in a tenant context, which a person's own request never runs
-- in. And nobody may be recorded as the decider of their own request, whatever
-- the application above says. A request SUPERSEDED because the person was
-- verified another way is not a decision, and stays allowed.
CREATE POLICY "requests_update" ON "verification_requests" FOR UPDATE
	USING ("tenant_id" = current_setting('app.tenant_id', true))
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND NOT ("status" IN ('approved', 'rejected') AND "decided_by" = "user_id")
	);
--> statement-breakpoint
-- No DELETE policy on purpose: nothing deletes a request. Details are purged on
-- decision instead, and the row stays so the rate limit has a memory.
COMMENT ON TABLE "verification_requests" IS 'Asks to be verified in a tenant. Details are purged on decision; rows are never deleted.';
