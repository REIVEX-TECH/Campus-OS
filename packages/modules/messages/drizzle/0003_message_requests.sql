-- Message requests: a new conversation starts as a request, not a chat.
--
-- `status` is 'pending' | 'active' | 'declined'. A conversation the requester
-- opens is 'pending' and holds exactly one message (theirs) until the recipient
-- accepts (-> 'active') or declines (-> 'declined'). `requested_by` is who opened
-- the request; `status_changed_at` stamps the last transition (the 30-day
-- re-request rule reads it). Every pre-existing conversation is a real chat, so it
-- defaults to 'active'.
--
-- No new policy or definer here. The status transitions are the recipient's own
-- UPDATE of the conversation row, already allowed by the participant policy (0000);
-- the service adds the business rules (only the recipient may accept/decline, the
-- requester may send only the first message while pending) inside the actor's
-- transaction. The one cross-cutting check this feature needs -- a bidirectional
-- block -- lives in communities (auth_blocked_between, 0012) and is composed at the
-- web route, never read from here.

ALTER TABLE "msg_conversations"
	ADD COLUMN "status" text NOT NULL DEFAULT 'active',
	ADD COLUMN "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	ADD COLUMN "status_changed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "msg_conversations"
	ADD CONSTRAINT "msg_conversations_status_valid"
	CHECK ("status" IN ('pending', 'active', 'declined'));
--> statement-breakpoint
-- The recipient's inbound-request list: their pending rows. A partial index keeps
-- it cheap as active conversations accumulate.
CREATE INDEX "msg_conversations_pending_idx"
	ON "msg_conversations" ("tenant_id", "participant_a", "participant_b")
	WHERE "status" = 'pending';
