-- The money ledger: append-only, double-entry, the single source of truth.
--
-- Every amount the platform holds, owes, or earns is a ledger entry. Balances are
-- never stored: a balance is the sum of the entries for an account, read on
-- demand. Entries belong to a transaction (`txn_id`) whose amounts sum to zero, so
-- money is only ever moved between accounts, never created or destroyed.
--
-- The application role cannot write this table at all -- INSERT/UPDATE/DELETE are
-- revoked from campusos_app by name, exactly as CLAUDE.md 8 requires for a table
-- the application must not write, and as the membership tables (0019) and order
-- events do. The ONLY writer is money_post_txn, an owner-run SECURITY DEFINER that
-- enforces the sum-to-zero invariant and idempotency, and is itself owner-only
-- (never granted to the app): the finance actions that move money -- confirming a
-- payment, releasing escrow, paying out, refunding -- are owner-run definers that
-- call it, and they arrive with the platform finance admin, gated on a grant per
-- CLAUDE.md 8. This migration is only the substrate and its one invariant-keeping
-- writer.
--
-- Reads: a person may read their OWN entries (their earnings/history) -- data
-- ownership on app.user_id, the accepted use, not a privilege decision. Every
-- other read (platform totals, fees by tenant) is a grant-gated definer with the
-- finance admin. tenant_id is a plain immutable slug, not a foreign key, so a
-- tenant lifecycle event can never mutate an append-only financial row.

CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"txn_id" uuid NOT NULL,
	"tenant_id" text,
	"account" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"amount_paisa" bigint NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"memo" text,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "ledger_entries_txn_idx" ON "ledger_entries" ("txn_id");
--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" ("account", "subject_type", "subject_id");
--> statement-breakpoint
CREATE INDEX "ledger_entries_ref_idx" ON "ledger_entries" ("ref_type", "ref_id");
--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_idx" ON "ledger_entries" ("tenant_id", "account");
--> statement-breakpoint

-- RLS: a person reads their own entries; nobody writes from the application side.
-- NO FORCE so the owner-run money_post_txn can INSERT (the owner is not bound by
-- the policies); the application role is a non-owner and is confined by the SELECT
-- policy plus the write revoke below.
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_entries_own_read" ON "ledger_entries" FOR SELECT
	USING ("subject_type" = 'user' AND "subject_id" = current_setting('app.user_id', true));
--> statement-breakpoint

-- Take the application role's write hands off the ledger entirely. Skipped on an
-- unsplit development database (the app owns the table there and the guarantee
-- cannot hold anyway); CI runs split, which is where it must hold.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname = 'ledger_entries' AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns ledger_entries: write lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "ledger_entries" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Post one balanced transaction to the ledger. The single writer. Enforces:
--   * the amounts sum to exactly zero (double-entry);
--   * every entry names an account, a subject, and a non-zero amount;
--   * a txn_id is posted at most once (idempotency for a retried finance action).
-- Owner-only: REVOKEd from PUBLIC and never granted to the application. The finance
-- definers (a later migration) run as the owner and call this; nothing the app can
-- run reaches it. Returns the number of entries written.
CREATE OR REPLACE FUNCTION money_post_txn(p_txn_id uuid, p_entries jsonb)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_sum numeric;
	v_count integer;
BEGIN
	IF p_txn_id IS NULL THEN
		RAISE EXCEPTION 'txn id required' USING ERRCODE = '22004';
	END IF;
	IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
		RAISE EXCEPTION 'entries must be a non-empty array' USING ERRCODE = '22023';
	END IF;
	IF EXISTS (SELECT 1 FROM ledger_entries WHERE txn_id = p_txn_id) THEN
		RAISE EXCEPTION 'txn % already posted', p_txn_id USING ERRCODE = '23505';
	END IF;
	SELECT coalesce(sum((e->>'amount_paisa')::bigint), 0) INTO v_sum
	FROM jsonb_array_elements(p_entries) e;
	IF v_sum <> 0 THEN
		RAISE EXCEPTION 'ledger transaction does not balance: sum=%', v_sum USING ERRCODE = '23514';
	END IF;
	IF EXISTS (
		SELECT 1 FROM jsonb_array_elements(p_entries) e
		WHERE coalesce(e->>'account', '') = ''
		   OR coalesce(e->>'subject_type', '') = ''
		   OR coalesce(e->>'subject_id', '') = ''
		   OR (e->>'amount_paisa') IS NULL
		   OR (e->>'amount_paisa')::bigint = 0
	) THEN
		RAISE EXCEPTION 'each entry needs account, subject, and a non-zero amount'
			USING ERRCODE = '22023';
	END IF;
	INSERT INTO ledger_entries (
		txn_id, tenant_id, account, subject_type, subject_id, amount_paisa, ref_type, ref_id, memo
	)
	SELECT p_txn_id,
	       nullif(e->>'tenant_id', ''),
	       e->>'account',
	       e->>'subject_type',
	       e->>'subject_id',
	       (e->>'amount_paisa')::bigint,
	       nullif(e->>'ref_type', ''),
	       nullif(e->>'ref_id', ''),
	       nullif(e->>'memo', '')
	FROM jsonb_array_elements(p_entries) e;
	GET DIAGNOSTICS v_count = ROW_COUNT;
	RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION money_post_txn(uuid, jsonb) FROM PUBLIC;
-- Deliberately NOT granted to campusos_app: the ledger's only writers are the
-- owner-run finance definers, which keep EXECUTE through the owner's default
-- privileges. The application never posts to the ledger directly.
