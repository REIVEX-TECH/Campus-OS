-- Marketplace (services): orders, an append-only event log, and reviews.
--
-- An order is private to its two parties (buyer, seller), not tenant-wide. Its
-- status moves ONLY through mkt_order_transition, a SECURITY DEFINER that locks
-- the order row, checks the actor is the order's buyer or seller for that edge,
-- writes the new status and timestamps, and appends one event -- all in the same
-- statement. The order is created only through mkt_place_order, which derives the
-- price/turnaround/revisions snapshot from the package itself (a raw write cannot
-- forge the agreed amount) and writes the opening event. Auto-complete
-- (mkt_order_autocomplete) finishes a delivered order the buyer left untouched.
--
-- The application role therefore cannot INSERT, UPDATE, or DELETE mkt_orders or
-- mkt_order_events at all -- those rights are revoked by name and every write goes
-- through an audited definer, exactly as the membership tables do (0019) and as
-- CLAUDE.md 8 requires for a table the application must not write. Reads are RLS:
-- a party sees their own orders and their events. Money does not move here; this
-- is the workflow only. Deciding a dispute is a platform action gated on a grant,
-- and lands with the finance admin, not in this file.

CREATE TABLE "mkt_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"gig_id" uuid NOT NULL REFERENCES "mkt_gigs"("id") ON DELETE RESTRICT,
	"package_id" uuid NOT NULL REFERENCES "mkt_gig_packages"("id") ON DELETE RESTRICT,
	"buyer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"title" text NOT NULL,
	"price_paisa" bigint NOT NULL,
	"delivery_days" integer NOT NULL,
	"revisions_allowed" integer NOT NULL DEFAULT 0,
	"revisions_used" integer NOT NULL DEFAULT 0,
	"payment_mode" text NOT NULL DEFAULT 'cash',
	"status" text NOT NULL DEFAULT 'requested',
	"requirements" text,
	"accepted_at" timestamptz,
	"paid_at" timestamptz,
	"started_at" timestamptz,
	"delivered_at" timestamptz,
	"completed_at" timestamptz,
	"cancelled_at" timestamptz,
	"disputed_at" timestamptz,
	"due_at" timestamptz,
	"cancel_reason" text,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mkt_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"order_id" uuid NOT NULL REFERENCES "mkt_orders"("id") ON DELETE CASCADE,
	"actor_id" uuid,
	"from_status" text,
	"to_status" text,
	"kind" text NOT NULL DEFAULT 'transition',
	"note" text,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mkt_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"order_id" uuid NOT NULL REFERENCES "mkt_orders"("id") ON DELETE CASCADE,
	"gig_id" uuid NOT NULL REFERENCES "mkt_gigs"("id") ON DELETE CASCADE,
	"reviewer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"rating" integer NOT NULL,
	"body" text NOT NULL DEFAULT '',
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mkt_orders_buyer_idx" ON "mkt_orders" ("tenant_id", "buyer_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mkt_orders_seller_idx" ON "mkt_orders" ("tenant_id", "seller_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mkt_orders_status_idx" ON "mkt_orders" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "mkt_orders_autocomplete_idx" ON "mkt_orders" ("status", "delivered_at");
--> statement-breakpoint
CREATE INDEX "mkt_order_events_order_idx" ON "mkt_order_events" ("order_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_reviews_order_uq" ON "mkt_reviews" ("order_id");
--> statement-breakpoint
CREATE INDEX "mkt_reviews_gig_idx" ON "mkt_reviews" ("gig_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mkt_reviews_seller_idx" ON "mkt_reviews" ("tenant_id", "seller_id", "created_at");
--> statement-breakpoint

-- RLS. Orders and events are readable only by the two parties; reviews are
-- tenant-wide readable (they appear on the public gig page). Orders and events are
-- NO FORCE so the owner-run definers below can read and write across parties; the
-- application role is a non-owner and is confined by these policies plus the
-- write revokes. Reviews are FORCE, like goods: written once by the reviewer, read
-- by everyone in the tenant.
ALTER TABLE "mkt_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mkt_orders_party" ON "mkt_orders" FOR SELECT
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND (
			"buyer_id"::text = current_setting('app.user_id', true)
			OR "seller_id"::text = current_setting('app.user_id', true)
		)
	);
--> statement-breakpoint
ALTER TABLE "mkt_order_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mkt_order_events_party" ON "mkt_order_events" FOR SELECT
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND EXISTS (
			SELECT 1 FROM mkt_orders o
			WHERE o.id = "order_id"
			  AND o.tenant_id = current_setting('app.tenant_id', true)
			  AND (
				o.buyer_id::text = current_setting('app.user_id', true)
				OR o.seller_id::text = current_setting('app.user_id', true)
			  )
		)
	);
--> statement-breakpoint
ALTER TABLE "mkt_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mkt_reviews_read" ON "mkt_reviews" FOR SELECT
	USING ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
-- The reviewer writes their own review, and only for a completed order they bought
-- against this gig. A permissive insert (as self) plus a RESTRICTIVE check that the
-- order exists, is theirs, is completed, and matches the gig -- so even a raw write
-- cannot fabricate a rating for a service never ordered.
CREATE POLICY "mkt_reviews_insert_self" ON "mkt_reviews" FOR INSERT
	WITH CHECK (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "reviewer_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint
CREATE POLICY "mkt_reviews_insert_earned" ON "mkt_reviews" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM mkt_orders o
			WHERE o.id = "order_id"
			  AND o.tenant_id = current_setting('app.tenant_id', true)
			  AND o.buyer_id::text = current_setting('app.user_id', true)
			  AND o.gig_id = "gig_id"
			  AND o.seller_id = "seller_id"
			  AND o.status = 'completed'
		)
	);
--> statement-breakpoint
ALTER TABLE "mkt_reviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Take the application role's write hands off orders and their events entirely: it
-- may only SELECT (its own, by the policies above). Every write is a definer.
-- Skipped on an unsplit development database, where the app owns the tables and
-- the guarantee cannot hold anyway; CI runs split, which is where it must hold.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	IF EXISTS (
		SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
		WHERE c.relname IN ('mkt_orders', 'mkt_order_events') AND r.rolname = 'campusos_app'
	) THEN
		RAISE WARNING 'campusos_app owns the order tables: write lock skipped (unsplit database).';
		RETURN;
	END IF;
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "mkt_orders" FROM campusos_app';
	EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "mkt_order_events" FROM campusos_app';
	-- Reviews are immutable once written: the reviewer inserts, nobody updates or
	-- deletes from the application side.
	EXECUTE 'REVOKE UPDATE, DELETE ON TABLE "mkt_reviews" FROM campusos_app';
END
$$;
--> statement-breakpoint

-- Place an order against a package. The buyer must be a verified member; the gig
-- and package must be active in this tenant and belong to each other. The snapshot
-- (title, price, delivery, revisions, seller) is read from the package HERE, so it
-- is the real agreed amount, not something a caller supplied. A buyer may not
-- order their own gig. Writes the opening 'requested' event. Returns the order id.
CREATE OR REPLACE FUNCTION mkt_place_order(
	p_tenant_id text, p_gig_id uuid, p_package_id uuid, p_payment_mode text, p_requirements text
)
	RETURNS uuid
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_seller uuid;
	v_title text;
	v_price bigint;
	v_delivery integer;
	v_revisions integer;
	v_mode text := CASE WHEN p_payment_mode = 'online' THEN 'online' ELSE 'cash' END;
	v_id uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM tenant_memberships m
		WHERE m.user_id = v_user AND m.tenant_id = p_tenant_id AND m.verified_at IS NOT NULL
		  AND (m.status = 'active' OR (m.standing_until IS NOT NULL AND m.standing_until <= now()))
	) THEN
		RAISE EXCEPTION 'must be a verified member to order' USING ERRCODE = '42501';
	END IF;
	-- The package and gig, joined and active, in this tenant.
	SELECT g.seller_id, g.title || ' - ' || pk.title, pk.price_paisa, pk.delivery_days, pk.revisions
	  INTO v_seller, v_title, v_price, v_delivery, v_revisions
	FROM mkt_gig_packages pk
	JOIN mkt_gigs g ON g.id = pk.gig_id
	WHERE pk.id = p_package_id AND pk.gig_id = p_gig_id
	  AND g.tenant_id = p_tenant_id AND g.status = 'active' AND g.deleted_at IS NULL;
	IF v_seller IS NULL THEN
		RAISE EXCEPTION 'no such gig or package' USING ERRCODE = '42501';
	END IF;
	IF v_seller = v_user THEN
		RAISE EXCEPTION 'cannot order your own gig' USING ERRCODE = '42501';
	END IF;
	INSERT INTO mkt_orders (
		tenant_id, gig_id, package_id, buyer_id, seller_id, title, price_paisa,
		delivery_days, revisions_allowed, payment_mode, status, requirements
	)
	VALUES (
		p_tenant_id, p_gig_id, p_package_id, v_user, v_seller, v_title, v_price,
		v_delivery, v_revisions, v_mode, 'requested', nullif(p_requirements, '')
	)
	RETURNING id INTO v_id;
	INSERT INTO mkt_order_events (tenant_id, order_id, actor_id, from_status, to_status, kind, note)
	VALUES (p_tenant_id, v_id, v_user, NULL, 'requested', 'transition', nullif(p_requirements, ''));
	RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Move an order along one edge of its lifecycle. Locks the row, derives the
-- actor's role (buyer or seller) from the order itself, checks the edge is one that
-- role may take from the current status (payment mode decides whether accept goes
-- to awaiting_payment or straight to in_progress; a revision needs one left),
-- writes the new status and its timestamps, and appends the event. Returns a small
-- text code: 'ok' | 'not_found' | 'not_party' | 'illegal'. Money does not move.
CREATE OR REPLACE FUNCTION mkt_order_transition(
	p_tenant_id text, p_order_id uuid, p_to text, p_note text
)
	RETURNS text
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_o mkt_orders%ROWTYPE;
	v_role text;
	v_from text;
	v_ok boolean := false;
	v_kind text := 'transition';
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	SELECT * INTO v_o FROM mkt_orders
	WHERE id = p_order_id AND tenant_id = p_tenant_id FOR UPDATE;
	IF NOT FOUND THEN
		RETURN 'not_found';
	END IF;
	IF v_user = v_o.buyer_id THEN
		v_role := 'buyer';
	ELSIF v_user = v_o.seller_id THEN
		v_role := 'seller';
	ELSE
		RETURN 'not_party';
	END IF;
	v_from := v_o.status;

	-- The allowed edges, by (from, to, role).
	IF v_from = 'requested' AND p_to = 'awaiting_payment' AND v_role = 'seller'
	   AND v_o.payment_mode = 'online' THEN
		v_ok := true;
	ELSIF v_from = 'requested' AND p_to = 'in_progress' AND v_role = 'seller'
	      AND v_o.payment_mode = 'cash' THEN
		v_ok := true;
	ELSIF v_from = 'requested' AND p_to = 'cancelled' AND v_role IN ('buyer', 'seller') THEN
		v_ok := true;
	ELSIF v_from = 'awaiting_payment' AND p_to = 'paid' AND v_role = 'buyer' THEN
		v_ok := true;
	ELSIF v_from = 'awaiting_payment' AND p_to = 'cancelled' AND v_role IN ('buyer', 'seller') THEN
		v_ok := true;
	ELSIF v_from = 'paid' AND p_to = 'in_progress' AND v_role = 'seller' THEN
		v_ok := true;
	ELSIF v_from = 'paid' AND p_to = 'cancelled' AND v_role = 'seller' THEN
		v_ok := true;
	ELSIF v_from = 'paid' AND p_to = 'disputed' AND v_role = 'buyer' THEN
		v_ok := true;
	ELSIF v_from = 'in_progress' AND p_to = 'delivered' AND v_role = 'seller' THEN
		v_ok := true;
	ELSIF v_from = 'in_progress' AND p_to = 'cancelled' AND v_role = 'seller' THEN
		v_ok := true;
	ELSIF v_from = 'in_progress' AND p_to = 'disputed' AND v_role = 'buyer' THEN
		v_ok := true;
	ELSIF v_from = 'delivered' AND p_to = 'completed' AND v_role = 'buyer' THEN
		v_ok := true;
	ELSIF v_from = 'delivered' AND p_to = 'in_progress' AND v_role = 'buyer'
	      AND v_o.revisions_used < v_o.revisions_allowed THEN
		v_ok := true;
		v_kind := 'revision';
	ELSIF v_from = 'delivered' AND p_to = 'disputed' AND v_role = 'buyer' THEN
		v_ok := true;
	END IF;

	IF NOT v_ok THEN
		RETURN 'illegal';
	END IF;

	UPDATE mkt_orders SET
		status = p_to,
		accepted_at = CASE
			WHEN p_to = 'awaiting_payment' THEN now()
			WHEN p_to = 'in_progress' AND v_from = 'requested' THEN now()
			ELSE accepted_at END,
		paid_at = CASE WHEN p_to = 'paid' THEN now() ELSE paid_at END,
		started_at = CASE WHEN p_to = 'in_progress' THEN now() ELSE started_at END,
		due_at = CASE
			WHEN p_to = 'in_progress' AND v_from IN ('requested', 'paid')
				THEN now() + (delivery_days * interval '1 day')
			ELSE due_at END,
		delivered_at = CASE WHEN p_to = 'delivered' THEN now() ELSE delivered_at END,
		completed_at = CASE WHEN p_to = 'completed' THEN now() ELSE completed_at END,
		cancelled_at = CASE WHEN p_to = 'cancelled' THEN now() ELSE cancelled_at END,
		cancel_reason = CASE WHEN p_to = 'cancelled' THEN nullif(p_note, '') ELSE cancel_reason END,
		disputed_at = CASE WHEN p_to = 'disputed' THEN now() ELSE disputed_at END,
		revisions_used = CASE
			WHEN p_to = 'in_progress' AND v_from = 'delivered' THEN revisions_used + 1
			ELSE revisions_used END
	WHERE id = p_order_id;

	INSERT INTO mkt_order_events (tenant_id, order_id, actor_id, from_status, to_status, kind, note)
	VALUES (p_tenant_id, p_order_id, v_user, v_from, p_to, v_kind, nullif(p_note, ''));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- Finish delivered orders the buyer never accepted, after the tenant's window.
-- Only 'delivered' orders older than p_days move to 'completed'; the window is
-- clamped to at least a day so a caller cannot complete fresh deliveries. A system
-- action: the event carries no actor. Returns the number completed.
CREATE OR REPLACE FUNCTION mkt_order_autocomplete(p_tenant_id text, p_days integer)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_days integer := greatest(coalesce(p_days, 7), 1);
	v_count integer;
BEGIN
	WITH done AS (
		UPDATE mkt_orders
		   SET status = 'completed', completed_at = now()
		 WHERE tenant_id = p_tenant_id AND status = 'delivered'
		   AND delivered_at IS NOT NULL
		   AND delivered_at < now() - (v_days * interval '1 day')
		RETURNING id
	), logged AS (
		INSERT INTO mkt_order_events (tenant_id, order_id, actor_id, from_status, to_status, kind, note)
		SELECT p_tenant_id, id, NULL, 'delivered', 'completed', 'transition', 'auto-complete'
		FROM done
		RETURNING 1
	)
	SELECT count(*)::int INTO v_count FROM logged;
	RETURN v_count;
END;
$$;
--> statement-breakpoint

-- These definers are the only writers of orders and events, so the application
-- must hold EXECUTE on them; the owner's default privileges would grant that, but
-- we set it explicitly and REVOKE FROM PUBLIC first (the 0019 discipline). They
-- take an actor from the GUC and act only within it -- placing/advancing the
-- caller's own order -- so 'app' EXECUTE is correct (this is data ownership, not a
-- platform privilege). Deciding a dispute is a separate, grant-gated definer that
-- ships with the finance admin.
REVOKE ALL ON FUNCTION mkt_place_order(text, uuid, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mkt_order_transition(text, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mkt_order_autocomplete(text, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION mkt_place_order(text, uuid, uuid, text, text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION mkt_order_transition(text, uuid, text, text) TO campusos_app';
		EXECUTE 'GRANT EXECUTE ON FUNCTION mkt_order_autocomplete(text, integer) TO campusos_app';
	END IF;
END
$$;
