-- The money-moving definers (design-money-movements.md §4). Every one:
--   * runs as the owner (SECURITY DEFINER, search_path=public) and calls
--     money_post_txn (0000), the only ledger writer, owner->owner;
--   * is idempotent by two layers: a status guard on the row (locked FOR UPDATE, so
--     a repeat is a no-op) AND a deterministic ledger txn_id md5('<verb>:'||id)::uuid
--     (money_post_txn refuses a second post of the same txn_id);
--   * uses integer paisa; the fee is floor(amount*1000/10000) = (amount*1000)/10000,
--     the same 10% as @campusos/core/payments feePaisa().
-- Ledger accounts: external (outside world), escrow (per order), seller_payable:<seller>,
-- platform_fee:platform, payout_hold:<seller>. Sign: a positive amount credits.
--
-- AUTHORIZATION (§8): the finance actions key on auth_finance_admin_for_txn() -- the
-- stamp for THIS txid, an unforgeable row -- never on a GUC. The two self-service
-- ones (pay_submit_receipt, payout_request, open_dispute) key on the order/balance
-- being the CALLER'S OWN, a data-ownership check, and take no stamp.
-- money_release_internal is mechanical (order completion), owner-only, no stamp.

-- ── Self-service: a buyer submits their payment receipt ───────────────────────────
-- Snapshots the trusted amount from mkt_orders (owner read; the buyer cannot forge
-- it) and moves the payment pending -> submitted. app-callable; the caller must be
-- the order's buyer and the order must be awaiting payment.
CREATE OR REPLACE FUNCTION pay_submit_receipt(p_order_id uuid, p_reference text, p_receipt_key text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_o record;
	v_fee bigint;
	v_net bigint;
BEGIN
	IF v_user IS NULL THEN RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501'; END IF;
	SELECT id, tenant_id, buyer_id, seller_id, price_paisa, status INTO v_o
	FROM mkt_orders WHERE id = p_order_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_o.buyer_id <> v_user THEN RETURN 'not_buyer'; END IF;
	IF v_o.status <> 'awaiting_payment' THEN RETURN 'bad_state'; END IF;
	v_fee := (v_o.price_paisa * 1000) / 10000;
	v_net := v_o.price_paisa - v_fee;
	INSERT INTO payments (tenant_id, order_id, buyer_id, seller_id, amount_paisa, fee_paisa,
	                      net_paisa, status, reference, receipt_key, submitted_at)
	VALUES (v_o.tenant_id, v_o.id, v_o.buyer_id, v_o.seller_id, v_o.price_paisa, v_fee, v_net,
	        'submitted', nullif(p_reference, ''), nullif(p_receipt_key, ''), now())
	ON CONFLICT (order_id) DO UPDATE
		SET status = 'submitted', reference = excluded.reference,
		    receipt_key = excluded.receipt_key, submitted_at = now()
		WHERE payments.status IN ('pending', 'submitted');
	IF NOT FOUND THEN RETURN 'bad_state'; END IF;
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Self-service: a seller requests a payout ─────────────────────────────────────
-- Available balance = the seller's seller_payable ledger sum; because a request
-- posts a hold (below), that sum already excludes held funds, so a seller cannot
-- request the same money twice. Posts seller_payable -A / payout_hold +A.
CREATE OR REPLACE FUNCTION payout_request(
	p_amount_paisa bigint, p_tenant_id text, p_method_cipher bytea, p_method_nonce bytea
)
	RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_available bigint;
	v_payout_id uuid;
BEGIN
	IF v_user IS NULL THEN RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501'; END IF;
	IF p_amount_paisa IS NULL OR p_amount_paisa <= 0 THEN
		RAISE EXCEPTION 'amount must be positive' USING ERRCODE = '22023';
	END IF;
	SELECT coalesce(sum(amount_paisa), 0) INTO v_available FROM ledger_entries
	WHERE account = 'seller_payable' AND subject_type = 'user' AND subject_id = v_user::text;
	IF p_amount_paisa > v_available THEN
		RAISE EXCEPTION 'insufficient balance' USING ERRCODE = '23514';
	END IF;
	INSERT INTO payouts (tenant_id, seller_id, amount_paisa, status, method_cipher, method_nonce)
	VALUES (nullif(p_tenant_id, ''), v_user, p_amount_paisa, 'requested', p_method_cipher, p_method_nonce)
	RETURNING id INTO v_payout_id;
	PERFORM money_post_txn(md5('hold:' || v_payout_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'seller_payable', 'subject_type', 'user',
			'subject_id', v_user::text, 'amount_paisa', -p_amount_paisa, 'tenant_id', nullif(p_tenant_id, ''),
			'ref_type', 'payout', 'ref_id', v_payout_id::text),
		jsonb_build_object('account', 'payout_hold', 'subject_type', 'user',
			'subject_id', v_user::text, 'amount_paisa', p_amount_paisa, 'tenant_id', nullif(p_tenant_id, ''),
			'ref_type', 'payout', 'ref_id', v_payout_id::text)
	));
	RETURN v_payout_id;
END;
$$;
--> statement-breakpoint

-- ── Self-service: a buyer opens a dispute on their order ─────────────────────────
CREATE OR REPLACE FUNCTION open_dispute(p_order_id uuid, p_reason text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_o record;
BEGIN
	IF v_user IS NULL THEN RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501'; END IF;
	IF coalesce(length(btrim(p_reason)), 0) < 2 THEN RETURN 'invalid'; END IF;
	SELECT id, tenant_id, buyer_id, seller_id, status INTO v_o
	FROM mkt_orders WHERE id = p_order_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_o.buyer_id <> v_user THEN RETURN 'not_buyer'; END IF;
	IF v_o.status NOT IN ('paid', 'in_progress', 'delivered', 'disputed') THEN RETURN 'bad_state'; END IF;
	INSERT INTO disputes (tenant_id, order_id, buyer_id, seller_id, opened_by, reason)
	VALUES (v_o.tenant_id, v_o.id, v_o.buyer_id, v_o.seller_id, v_user, btrim(p_reason))
	ON CONFLICT (order_id) DO NOTHING;
	IF NOT FOUND THEN RETURN 'exists'; END IF;
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Finance: confirm a submitted payment -> money enters escrow ──────────────────
CREATE OR REPLACE FUNCTION finance_confirm_payment(p_payment_id uuid)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_p record;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	SELECT * INTO v_p FROM payments WHERE id = p_payment_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_p.status <> 'submitted' THEN RETURN 'bad_state'; END IF;
	UPDATE payments SET status = 'confirmed', decided_by = v_admin, decided_at = now()
	WHERE id = p_payment_id;
	PERFORM money_post_txn(md5('confirm:' || p_payment_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'external', 'subject_type', 'platform', 'subject_id', 'platform',
			'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'payment', 'ref_id', p_payment_id::text),
		jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', v_p.order_id::text,
			'amount_paisa', v_p.amount_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'payment', 'ref_id', p_payment_id::text)
	));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Finance: reject a submitted payment -> no money moves ────────────────────────
CREATE OR REPLACE FUNCTION finance_reject_payment(p_payment_id uuid, p_reason text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_status text;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	SELECT status INTO v_status FROM payments WHERE id = p_payment_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_status <> 'submitted' THEN RETURN 'bad_state'; END IF;
	UPDATE payments SET status = 'rejected', decided_by = v_admin, decided_at = now(),
		reference = coalesce(nullif(p_reason, ''), reference)
	WHERE id = p_payment_id;
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Mechanical: release escrow to the seller on order completion ─────────────────
-- OWNER-ONLY (revoked from the app by name): reached only owner->owner from the
-- order-completion path. No stamp -- completion is the buyer's own authorized action
-- and the amount is fixed by the confirmed payment. Posts escrow -A / seller_payable
-- +net / platform_fee +fee. Idempotent via the release:<orderId> txn_id.
CREATE OR REPLACE FUNCTION money_release_internal(p_order_id uuid)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_p record;
BEGIN
	SELECT * INTO v_p FROM payments WHERE order_id = p_order_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'skip'; END IF;             -- cash order: nothing entered escrow
	IF v_p.status <> 'confirmed' THEN RETURN 'skip'; END IF;
	IF EXISTS (SELECT 1 FROM ledger_entries WHERE txn_id = md5('release:' || p_order_id::text)::uuid) THEN
		RETURN 'noop';
	END IF;
	PERFORM money_post_txn(md5('release:' || p_order_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', p_order_id::text,
			'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'mkt_order', 'ref_id', p_order_id::text),
		jsonb_build_object('account', 'seller_payable', 'subject_type', 'user', 'subject_id', v_p.seller_id::text,
			'amount_paisa', v_p.net_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'mkt_order', 'ref_id', p_order_id::text),
		jsonb_build_object('account', 'platform_fee', 'subject_type', 'platform', 'subject_id', 'platform',
			'amount_paisa', v_p.fee_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'mkt_order', 'ref_id', p_order_id::text)
	));
	RETURN 'released';
END;
$$;
--> statement-breakpoint

-- ── Finance: refund escrow to the buyer (only before release) ────────────────────
CREATE OR REPLACE FUNCTION finance_refund(p_order_id uuid, p_reason text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_p record;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	SELECT * INTO v_p FROM payments WHERE order_id = p_order_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_p.status <> 'confirmed' THEN RETURN 'bad_state'; END IF;   -- not confirmed or already refunded
	IF EXISTS (SELECT 1 FROM ledger_entries WHERE txn_id = md5('release:' || p_order_id::text)::uuid) THEN
		RETURN 'already_released';   -- once with the seller, resolution is a dispute, not a plain refund (Q5)
	END IF;
	UPDATE payments SET status = 'refunded', decided_by = v_admin, decided_at = now(),
		reference = coalesce(nullif(p_reason, ''), reference)
	WHERE id = v_p.id;
	PERFORM money_post_txn(md5('refund:' || p_order_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', p_order_id::text,
			'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'mkt_order', 'ref_id', p_order_id::text),
		jsonb_build_object('account', 'external', 'subject_type', 'platform', 'subject_id', 'platform',
			'amount_paisa', v_p.amount_paisa, 'tenant_id', v_p.tenant_id,
			'ref_type', 'mkt_order', 'ref_id', p_order_id::text)
	));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Finance: resolve a dispute (refund | release | split) ────────────────────────
CREATE OR REPLACE FUNCTION finance_resolve_dispute(
	p_dispute_id uuid, p_resolution text, p_seller_paisa bigint
)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_d record;
	v_p record;
	v_seller_gross bigint;
	v_seller_fee bigint;
	v_seller_net bigint;
	v_buyer_refund bigint;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	IF p_resolution NOT IN ('refund', 'release', 'split') THEN RETURN 'invalid'; END IF;
	SELECT * INTO v_d FROM disputes WHERE id = p_dispute_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_d.status <> 'open' THEN RETURN 'bad_state'; END IF;
	SELECT * INTO v_p FROM payments WHERE order_id = v_d.order_id FOR UPDATE;
	IF NOT FOUND OR v_p.status <> 'confirmed' THEN RETURN 'bad_state'; END IF;
	IF EXISTS (SELECT 1 FROM ledger_entries WHERE txn_id = md5('release:' || v_d.order_id::text)::uuid) THEN
		RETURN 'already_released';
	END IF;

	IF p_resolution = 'refund' THEN
		PERFORM money_post_txn(md5('drefund:' || p_dispute_id::text)::uuid, jsonb_build_array(
			jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', v_d.order_id::text,
				'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'external', 'subject_type', 'platform', 'subject_id', 'platform',
				'amount_paisa', v_p.amount_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text)
		));
		UPDATE payments SET status = 'refunded', decided_by = v_admin, decided_at = now() WHERE id = v_p.id;
	ELSIF p_resolution = 'release' THEN
		PERFORM money_post_txn(md5('drelease:' || p_dispute_id::text)::uuid, jsonb_build_array(
			jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', v_d.order_id::text,
				'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'seller_payable', 'subject_type', 'user', 'subject_id', v_p.seller_id::text,
				'amount_paisa', v_p.net_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'platform_fee', 'subject_type', 'platform', 'subject_id', 'platform',
				'amount_paisa', v_p.fee_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text)
		));
	ELSE  -- split: the seller gets p_seller_paisa gross (net of its proportional fee); the buyer the rest
		IF p_seller_paisa IS NULL OR p_seller_paisa < 0 OR p_seller_paisa > v_p.amount_paisa THEN
			RETURN 'invalid';
		END IF;
		v_seller_gross := p_seller_paisa;
		v_seller_fee := (v_seller_gross * 1000) / 10000;
		v_seller_net := v_seller_gross - v_seller_fee;
		v_buyer_refund := v_p.amount_paisa - v_seller_gross;
		PERFORM money_post_txn(md5('split:' || p_dispute_id::text)::uuid, jsonb_build_array(
			jsonb_build_object('account', 'escrow', 'subject_type', 'order', 'subject_id', v_d.order_id::text,
				'amount_paisa', -v_p.amount_paisa, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'seller_payable', 'subject_type', 'user', 'subject_id', v_p.seller_id::text,
				'amount_paisa', v_seller_net, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'platform_fee', 'subject_type', 'platform', 'subject_id', 'platform',
				'amount_paisa', v_seller_fee, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text),
			jsonb_build_object('account', 'external', 'subject_type', 'platform', 'subject_id', 'platform',
				'amount_paisa', v_buyer_refund, 'tenant_id', v_p.tenant_id, 'ref_type', 'dispute', 'ref_id', p_dispute_id::text)
		));
	END IF;

	UPDATE disputes SET status = 'resolved', resolution = p_resolution,
		seller_paisa = CASE WHEN p_resolution = 'split' THEN p_seller_paisa ELSE NULL END,
		resolved_by = v_admin, resolved_at = now()
	WHERE id = p_dispute_id;
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Finance: mark a payout paid -> money leaves the platform ─────────────────────
CREATE OR REPLACE FUNCTION finance_mark_payout_paid(p_payout_id uuid, p_reference text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_po record;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	SELECT * INTO v_po FROM payouts WHERE id = p_payout_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_po.status NOT IN ('requested', 'approved') THEN RETURN 'bad_state'; END IF;
	UPDATE payouts SET status = 'paid', decided_by = v_admin, decided_at = now(),
		reference = nullif(p_reference, '')
	WHERE id = p_payout_id;
	PERFORM money_post_txn(md5('payout:' || p_payout_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'payout_hold', 'subject_type', 'user', 'subject_id', v_po.seller_id::text,
			'amount_paisa', -v_po.amount_paisa, 'tenant_id', v_po.tenant_id, 'ref_type', 'payout', 'ref_id', p_payout_id::text),
		jsonb_build_object('account', 'external', 'subject_type', 'platform', 'subject_id', 'platform',
			'amount_paisa', v_po.amount_paisa, 'tenant_id', v_po.tenant_id, 'ref_type', 'payout', 'ref_id', p_payout_id::text)
	));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- ── Finance: reject a payout -> release the hold back to the seller ──────────────
CREATE OR REPLACE FUNCTION finance_reject_payout(p_payout_id uuid, p_reason text)
	RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_admin uuid := auth_finance_admin_for_txn();
	v_po record;
BEGIN
	IF v_admin IS NULL THEN
		RAISE EXCEPTION 'finance action outside an authorized finance txn' USING ERRCODE = '42501';
	END IF;
	SELECT * INTO v_po FROM payouts WHERE id = p_payout_id FOR UPDATE;
	IF NOT FOUND THEN RETURN 'not_found'; END IF;
	IF v_po.status NOT IN ('requested', 'approved') THEN RETURN 'bad_state'; END IF;
	UPDATE payouts SET status = 'rejected', decided_by = v_admin, decided_at = now(),
		reference = coalesce(nullif(p_reason, ''), reference)
	WHERE id = p_payout_id;
	PERFORM money_post_txn(md5('payout_reject:' || p_payout_id::text)::uuid, jsonb_build_array(
		jsonb_build_object('account', 'payout_hold', 'subject_type', 'user', 'subject_id', v_po.seller_id::text,
			'amount_paisa', -v_po.amount_paisa, 'tenant_id', v_po.tenant_id, 'ref_type', 'payout', 'ref_id', p_payout_id::text),
		jsonb_build_object('account', 'seller_payable', 'subject_type', 'user', 'subject_id', v_po.seller_id::text,
			'amount_paisa', v_po.amount_paisa, 'tenant_id', v_po.tenant_id, 'ref_type', 'payout', 'ref_id', p_payout_id::text)
	));
	RETURN 'ok';
END;
$$;
--> statement-breakpoint

-- EXECUTE grants. The self-service and finance definers are app-callable (they
-- self-check the caller's ownership or the finance stamp). money_release_internal is
-- OWNER-ONLY -- revoke it from the app by name so only an owner->owner call (the
-- order-completion wiring) can reach it; a bare REVOKE FROM PUBLIC would leave the
-- db-grants default EXECUTE in place. Guarded to the split database.
REVOKE ALL ON FUNCTION pay_submit_receipt(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION payout_request(bigint, text, bytea, bytea) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION open_dispute(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_confirm_payment(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_reject_payment(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION money_release_internal(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_refund(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_resolve_dispute(uuid, text, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_mark_payout_paid(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finance_reject_payout(uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
	v_split boolean;
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		RETURN;
	END IF;
	-- money_release_internal is owner-only only where the app is NOT the owner; on an
	-- unsplit dev database the app owns everything and the guarantee cannot hold.
	SELECT pg_get_userbyid(p.proowner) <> 'campusos_app' INTO v_split
	FROM pg_proc p WHERE p.proname = 'money_release_internal'
	  AND p.pronamespace = 'public'::regnamespace LIMIT 1;
	EXECUTE 'GRANT EXECUTE ON FUNCTION pay_submit_receipt(uuid, text, text) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION payout_request(bigint, text, bytea, bytea) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION open_dispute(uuid, text) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_confirm_payment(uuid) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_reject_payment(uuid, text) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_refund(uuid, text) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_resolve_dispute(uuid, text, bigint) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_mark_payout_paid(uuid, text) TO campusos_app';
	EXECUTE 'GRANT EXECUTE ON FUNCTION finance_reject_payout(uuid, text) TO campusos_app';
	-- money_release_internal is owner-only. REVOKE FROM PUBLIC above does NOT remove
	-- the db-grants default EXECUTE the owner's every new function grants campusos_app,
	-- so revoke it BY NAME (only where the app is not the owner; an unsplit dev database
	-- keeps app == owner and cannot hold the guarantee anyway).
	IF v_split IS true THEN
		EXECUTE 'REVOKE EXECUTE ON FUNCTION money_release_internal(uuid) FROM campusos_app';
	END IF;
END
$$;
