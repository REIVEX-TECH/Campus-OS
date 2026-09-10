-- Finance rows: a buyer's payment against an order, a seller's payout request, and
-- a dispute (design-money-movements.md §3). Each is append-only where it matters and
-- has its privileged columns kept out of the application's hands: like the ledger
-- (0000) and the membership tables (0019), ALL writes are revoked from campusos_app
-- by name and routed through the definers in 0003. Reads are party-scoped
-- (buyer/seller/opener = app.user_id), data ownership, not a privilege decision.
--
-- order_id references mkt_orders.id by value, NOT a cross-module foreign key: the
-- money module has no code dependency on marketplace (CLAUDE.md §4); the definers
-- read mkt_orders (owner, NO FORCE) for the trusted amount and parties.

CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"amount_paisa" bigint NOT NULL,
	"fee_paisa" bigint NOT NULL,
	"net_paisa" bigint NOT NULL,
	"provider" text NOT NULL DEFAULT 'manual',
	"status" text NOT NULL DEFAULT 'pending',
	"reference" text,
	"receipt_key" text,
	"submitted_at" timestamptz,
	"decided_at" timestamptz,
	"decided_by" uuid,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" ("order_id");
--> statement-breakpoint
CREATE INDEX "payments_queue_idx" ON "payments" ("status", "created_at");
--> statement-breakpoint

CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"amount_paisa" bigint NOT NULL,
	"status" text NOT NULL DEFAULT 'requested',
	"method_cipher" bytea NOT NULL,
	"method_nonce" bytea NOT NULL,
	"reference" text,
	"requested_at" timestamptz NOT NULL DEFAULT now(),
	"decided_at" timestamptz,
	"decided_by" uuid
);
--> statement-breakpoint
CREATE INDEX "payouts_queue_idx" ON "payouts" ("status", "requested_at");
--> statement-breakpoint
CREATE INDEX "payouts_seller_idx" ON "payouts" ("seller_id", "requested_at");
--> statement-breakpoint

CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL DEFAULT 'open',
	"resolution" text,
	"seller_paisa" bigint,
	"resolved_by" uuid,
	"opened_at" timestamptz NOT NULL DEFAULT now(),
	"resolved_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_order_uq" ON "disputes" ("order_id");
--> statement-breakpoint

-- RLS: party read only; NO FORCE so the owner-run definers can read/write across
-- parties (the app is a non-owner and, with its writes revoked by name below, can
-- only SELECT its own rows).
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payments_party_read" ON "payments" FOR SELECT
	USING (
		"buyer_id"::text = current_setting('app.user_id', true)
		OR "seller_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payouts_owner_read" ON "payouts" FOR SELECT
	USING ("seller_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "disputes_party_read" ON "disputes" FOR SELECT
	USING (
		"buyer_id"::text = current_setting('app.user_id', true)
		OR "seller_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint

-- Take the application role's write hands off all three: every write goes through a
-- definer (0003). A bare REVOKE FROM PUBLIC would not remove the default table grant
-- (db-grants ALTER DEFAULT PRIVILEGES), so revoke BY NAME. Skipped on an unsplit dev
-- database where the app owns the tables and the guarantee cannot hold anyway.
DO $$
DECLARE
	t text;
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	FOREACH t IN ARRAY ARRAY['payments', 'payouts', 'disputes'] LOOP
		IF EXISTS (
			SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
			WHERE c.relname = t AND r.rolname = 'campusos_app'
		) THEN
			RAISE WARNING 'campusos_app owns %: write lock skipped (unsplit database).', t;
		ELSE
			EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE %I FROM campusos_app', t);
		END IF;
	END LOOP;
END
$$;
