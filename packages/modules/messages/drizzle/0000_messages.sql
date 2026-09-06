-- Direct messages: private 1:1 conversations between two members of one tenant.
--
-- The guarantee is participation, not tenancy: a conversation, its per-person
-- read state, and its messages are visible ONLY to the two participants. RLS is
-- the boundary (CLAUDE.md §4). The tables are ENABLED but NOT forced, the same
-- choice lost-found claims made (0001): a later moderation migration adds an
-- owner-run definer that must read a reported message across participants, and
-- FORCE would bind the owner and hide it. The application role is a non-owner and
-- stays confined by the policies below regardless; the owner (migrations and the
-- audited definer) is the only reader that crosses a conversation, on purpose.
--
-- Writes are the actor's own: a conversation only exists with its creator as a
-- participant, a message is written only by its sender into a conversation they
-- belong to, and a person's read state is written only by that person. Read
-- receipts are the exception to "own row": both participants may READ each
-- other's state row (so the sender can see "read"), but each writes only theirs.
--
-- Ephemerality columns (expires_at, first_viewed_at) and the moderation surface
-- are reserved here and enforced in later migrations; this one is the core model.

CREATE TABLE "msg_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"participant_a" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"participant_b" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"ephemerality" text NOT NULL DEFAULT 'never',
	"last_message_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	-- Participants are stored ordered (a < b) so a pair maps to exactly one row.
	CONSTRAINT "msg_conversations_ordered" CHECK ("participant_a" < "participant_b")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "msg_conversations_pair_idx"
	ON "msg_conversations" ("tenant_id", "participant_a", "participant_b");
--> statement-breakpoint
CREATE INDEX "msg_conversations_a_idx"
	ON "msg_conversations" ("tenant_id", "participant_a", "last_message_at");
--> statement-breakpoint
CREATE INDEX "msg_conversations_b_idx"
	ON "msg_conversations" ("tenant_id", "participant_b", "last_message_at");
--> statement-breakpoint

CREATE TABLE "msg_participant_state" (
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "msg_conversations"("id") ON DELETE CASCADE,
	"participant_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"last_read_at" timestamptz,
	"cleared_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY ("conversation_id", "participant_id")
);
--> statement-breakpoint
CREATE INDEX "msg_participant_state_person_idx"
	ON "msg_participant_state" ("tenant_id", "participant_id");
--> statement-breakpoint

CREATE TABLE "msg_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"conversation_id" uuid NOT NULL REFERENCES "msg_conversations"("id") ON DELETE CASCADE,
	"sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"body" text NOT NULL,
	"reply_to_id" uuid REFERENCES "msg_messages"("id") ON DELETE SET NULL,
	"edited_at" timestamptz,
	"deleted_at" timestamptz,
	"expires_at" timestamptz,
	"first_viewed_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "msg_messages_thread_idx"
	ON "msg_messages" ("conversation_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "msg_messages_expiry_idx" ON "msg_messages" ("tenant_id", "expires_at");
--> statement-breakpoint

-- RLS: enabled, not forced (see header). The application role is confined; the
-- owner and the future audited definer are not.
ALTER TABLE "msg_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "msg_participant_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "msg_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A conversation is visible to, and writable by, its two participants only, and
-- only in its own tenant. WITH CHECK keeps a created row from naming the actor
-- out of it.
CREATE POLICY "msg_conversations_access" ON "msg_conversations" FOR ALL
	USING (
		tenant_id = current_setting('app.tenant_id', true)
		AND (
			participant_a::text = current_setting('app.user_id', true)
			OR participant_b::text = current_setting('app.user_id', true)
		)
	)
	WITH CHECK (
		tenant_id = current_setting('app.tenant_id', true)
		AND (
			participant_a::text = current_setting('app.user_id', true)
			OR participant_b::text = current_setting('app.user_id', true)
		)
	);
--> statement-breakpoint

-- Read state: both participants may READ both state rows (so a sender sees
-- "read"), but each may write only their own. Three per-command policies.
CREATE POLICY "msg_participant_state_read" ON "msg_participant_state" FOR SELECT
	USING (
		tenant_id = current_setting('app.tenant_id', true)
		AND EXISTS (
			SELECT 1 FROM msg_conversations c
			WHERE c.id = msg_participant_state.conversation_id
			  AND (
				c.participant_a::text = current_setting('app.user_id', true)
				OR c.participant_b::text = current_setting('app.user_id', true)
			  )
		)
	);
--> statement-breakpoint
CREATE POLICY "msg_participant_state_insert" ON "msg_participant_state" FOR INSERT
	WITH CHECK (
		tenant_id = current_setting('app.tenant_id', true)
		AND participant_id::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint
CREATE POLICY "msg_participant_state_update" ON "msg_participant_state" FOR UPDATE
	USING (participant_id::text = current_setting('app.user_id', true))
	WITH CHECK (participant_id::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- A message is visible to the conversation's participants; written only by its
-- sender, into a conversation they belong to; edited or tombstoned only by its
-- sender. (The edit/delete WINDOWS are enforced in the service; RLS enforces
-- authorship.)
CREATE POLICY "msg_messages_read" ON "msg_messages" FOR SELECT
	USING (
		tenant_id = current_setting('app.tenant_id', true)
		AND EXISTS (
			SELECT 1 FROM msg_conversations c
			WHERE c.id = msg_messages.conversation_id
			  AND (
				c.participant_a::text = current_setting('app.user_id', true)
				OR c.participant_b::text = current_setting('app.user_id', true)
			  )
		)
	);
--> statement-breakpoint
CREATE POLICY "msg_messages_insert" ON "msg_messages" FOR INSERT
	WITH CHECK (
		tenant_id = current_setting('app.tenant_id', true)
		AND sender_id::text = current_setting('app.user_id', true)
		AND EXISTS (
			SELECT 1 FROM msg_conversations c
			WHERE c.id = msg_messages.conversation_id
			  AND (
				c.participant_a::text = current_setting('app.user_id', true)
				OR c.participant_b::text = current_setting('app.user_id', true)
			  )
		)
	);
--> statement-breakpoint
CREATE POLICY "msg_messages_update" ON "msg_messages" FOR UPDATE
	USING (sender_id::text = current_setting('app.user_id', true))
	WITH CHECK (sender_id::text = current_setting('app.user_id', true));
