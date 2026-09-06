-- Claims: a claimant asserting an item is theirs, and the private thread with the
-- item's reporter.
--
-- Unlike items, claims and their messages are NEVER tenant-wide readable: RLS
-- confines them to the two participants — the claimant and the item's reporter —
-- with moderators reading only through a gated SECURITY DEFINER (a later PR). This
-- is the M1/M2 lesson: "who claimed what, and what they said" is private, so it is
-- not on any tenant-wide policy. Participation is data isolation keyed on
-- app.user_id (reading your own claims, or claims on your own item) — not a
-- privilege decision. RLS is enabled but not forced so the moderator definer (a
-- later PR) can read across participants; the application role is a non-owner and
-- stays confined by the policies regardless.

CREATE TABLE "lf_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"item_id" uuid NOT NULL REFERENCES "lf_items"("id") ON DELETE CASCADE,
	"claimant_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"message" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"decided_at" timestamptz,
	"deleted_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lf_claim_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"claim_id" uuid NOT NULL REFERENCES "lf_claims"("id") ON DELETE CASCADE,
	"sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"body" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- The claim that resolved an item.
ALTER TABLE "lf_items"
	ADD CONSTRAINT "lf_items_resolved_via_claim_fk"
	FOREIGN KEY ("resolved_via_claim_id") REFERENCES "lf_claims"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "lf_claims_item_idx" ON "lf_claims" ("tenant_id", "item_id", "status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "lf_claims_one_open_uq" ON "lf_claims" ("item_id", "claimant_id")
	WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "lf_claims_claimant_idx" ON "lf_claims" ("tenant_id", "claimant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "lf_claim_messages_claim_idx" ON "lf_claim_messages" ("claim_id", "created_at");
--> statement-breakpoint

-- RLS is enabled but NOT forced, deliberately: the moderator read is an
-- owner-run SECURITY DEFINER (a later PR, gated on lostfound.moderate), and FORCE
-- would bind the owner to the participant policy too and hide claims from
-- moderation. The application role is a non-owner, so it stays bound by the
-- policies below regardless of FORCE — the tenant_memberships / M1 pattern.
ALTER TABLE "lf_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lf_claim_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A claim is visible only to its two participants: the claimant, or the reporter
-- of the item it is on. The reporter check reads lf_items, itself under RLS, so it
-- resolves within the tenant. Moderators are neither, and read through a definer.
CREATE POLICY "lf_claims_participants" ON "lf_claims" FOR ALL
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND (
			"claimant_id"::text = current_setting('app.user_id', true)
			OR EXISTS (
				SELECT 1 FROM lf_items i
				WHERE i.id = "lf_claims"."item_id"
				  AND i.reporter_id::text = current_setting('app.user_id', true)
			)
		)
	)
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND (
			"claimant_id"::text = current_setting('app.user_id', true)
			OR EXISTS (
				SELECT 1 FROM lf_items i
				WHERE i.id = "lf_claims"."item_id"
				  AND i.reporter_id::text = current_setting('app.user_id', true)
			)
		)
	);
--> statement-breakpoint
-- A claim is CREATED only by the claimant, as themselves.
CREATE POLICY "lf_claims_insert_self" ON "lf_claims" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("claimant_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- A message is visible exactly when its parent claim is: the subquery on lf_claims
-- is itself filtered by the participant policy above, so a non-participant sees no
-- claim and therefore no message.
CREATE POLICY "lf_claim_messages_participants" ON "lf_claim_messages" FOR ALL
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND EXISTS (SELECT 1 FROM lf_claims c WHERE c.id = "lf_claim_messages"."claim_id")
	)
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND EXISTS (SELECT 1 FROM lf_claims c WHERE c.id = "lf_claim_messages"."claim_id")
	);
--> statement-breakpoint
-- A message is SENT only as oneself.
CREATE POLICY "lf_claim_messages_sender_self" ON "lf_claim_messages" AS RESTRICTIVE FOR INSERT
	WITH CHECK ("sender_id"::text = current_setting('app.user_id', true));
