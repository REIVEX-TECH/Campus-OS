# Block 4 — money movements and finance admin (design for review)

**Status: design only. No SQL in this document has been applied, and none should be
until it has had the CLAUDE.md §6 adversarial review of the concrete SQL.** This is
the plan for the money-moving definers, the tables they touch, the authorization
anchor they key on, the ledger entries they write, their idempotency keys, and
their failure modes; plus the `PAYOUT_ENCRYPTION_KEY` scheme and the finance-admin
pages. Read it as the thing to break before it exists.

Two Phase-5 escalations (keying containment on `app.grant_use`, then on
`app.user_id`) both passed a _design_ review and were caught only on the
_implementation_. So treat the SQL below as a proposal to attack, not a spec to
build.

---

## 1. Principles (unchanged from the ledger substrate)

- **The ledger is the truth.** Every movement is one balanced `money_post_txn`
  call (`packages/modules/money/drizzle/0000_money.sql`): the entries of a
  transaction sum to zero, balances are the sum of an account's entries, and the
  application role can neither write `ledger_entries` nor execute `money_post_txn`.
  All the definers below run **as the owner** and call `money_post_txn`
  (owner → owner); nothing new grants the app a way into the ledger.
- **Integer paisa, PKR only.** No floats. The fee is `feePaisa()` from
  `@campusos/core/payments` (`floor(amount * 1000 / 10000)`, 10%); the SQL uses the
  same integer arithmetic and cites that constant.
- **Authorization keys on an unforgeable row, never a GUC (§8).** Every action
  here is a _platform privilege_ (deciding another party's money). None of them may
  key on `app.user_id` / `app.tenant_id`. They key on a **use-row stamped with
  `pg_current_xact_id()`**, read through a definer over a table the app cannot
  write — the exact mechanism the tenant grants use
  (`platform_grant_uses` / `auth_grant_admin_for_txn()`, identity 0018).

---

## 2. The authorization anchor: `platform_finance_uses`

Finance is platform-level (a seller's earnings and payouts are the platform's
liability, not a tenant's), so it needs a platform-global analogue of the
tenant-grant use-row. It is the **one new privilege primitive** in this block and
the first thing to review.

```sql
-- A stamp that says "a verified platform admin authorized THIS transaction to move
-- money." Written only by auth_begin_finance (below); the app has no read or write.
CREATE TABLE "platform_finance_uses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "txid" xid8 NOT NULL,
    "at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "platform_finance_uses_txid_idx" ON "platform_finance_uses" ("txid");

ALTER TABLE "platform_finance_uses" ENABLE ROW LEVEL SECURITY;  -- NO FORCE; owner-read
-- No policy at all: the app sees nothing and reaches it only through the definers.
-- In a split DB, revoke every app right by name (the 0018 discipline):
--   REVOKE ALL ON TABLE "platform_finance_uses" FROM campusos_app;
```

```sql
-- Begin a finance transaction. Verifies the CALLER is a platform admin -- read
-- from platform_roles, which the app cannot write (identity 0016) -- and stamps
-- the current txid. Returns nothing; its effect is the stamp. Owner-only definer.
--
-- The platform_roles read is by app.user_id, the same trust the whole session
-- rests on; the STAMP is what makes the later checks unforgeable, because a money
-- definer asks "is there a stamp for THIS txid?", a row the caller cannot see,
-- forge, or carry into another transaction.
CREATE OR REPLACE FUNCTION auth_begin_finance()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM platform_roles pr
        WHERE pr.user_id = v_user AND pr.role = 'platform_admin'
    ) THEN
        RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
    END IF;
    INSERT INTO platform_finance_uses (actor_user_id, txid) VALUES (v_user, pg_current_xact_id());
END; $$;
-- REVOKE FROM PUBLIC; then GRANT EXECUTE ... TO campusos_app (app may CALL it; it
-- self-checks and only ever stamps for the authenticated caller).
```

```sql
-- The anchor every money definer reads: the platform admin who authorized THIS
-- transaction, or NULL. A definer, because the app has no read on the uses table.
CREATE OR REPLACE FUNCTION auth_finance_admin_for_txn()
    RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.actor_user_id FROM platform_finance_uses u
    WHERE u.txid = pg_current_xact_id_if_assigned()
    ORDER BY u.at DESC LIMIT 1;
$$;
-- REVOKE FROM PUBLIC; GRANT EXECUTE ... TO campusos_app.
```

Every money definer below begins:

```sql
v_admin uuid := auth_finance_admin_for_txn();
IF v_admin IS NULL THEN RAISE EXCEPTION 'finance action outside an authorized finance txn'
    USING ERRCODE = '42501'; END IF;
```

The application flow is: the platform `/admin` finance route, in one transaction,
calls `auth_begin_finance()` and then the money definer. If the caller is not a
platform admin the stamp is never written and the definer refuses. **Open question
for review (Q1): is a platform-global stamp the right anchor, or should each money
action instead require the tenant-grant use-row of the order's tenant
(`auth_grant_admin_for_txn()`)? The former is simpler and matches "finance is
platform-level"; the latter reuses an audited primitive and ties every money move
to a tenant grant. I lean platform-global, but this is the crux and yours to call.**

---

## 3. New tables (besides the ledger, which exists)

### 3.1 `payments` — a buyer's payment against an order

```sql
CREATE TABLE "payments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" text NOT NULL,                    -- plain slug, for per-tenant fee reporting
    "order_id" uuid NOT NULL,                     -- mkt_orders.id (no cross-module FK)
    "buyer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "amount_paisa" bigint NOT NULL,               -- gross, snapshot of the order price
    "fee_paisa" bigint NOT NULL,                  -- feePaisa(amount), snapshot
    "net_paisa" bigint NOT NULL,                  -- amount - fee, snapshot
    "provider" text NOT NULL DEFAULT 'manual',    -- 'manual' | 'fake' | future gateway
    "status" text NOT NULL DEFAULT 'pending',     -- pending|submitted|confirmed|rejected|refunded
    "reference" text,                             -- buyer's transfer reference (manual)
    "receipt_key" text,                           -- @campusos/media object key of the receipt image
    "submitted_at" timestamptz,
    "decided_at" timestamptz,
    "decided_by" uuid,                            -- the platform admin (from the stamp)
    "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" ("order_id");   -- one live payment per order
CREATE INDEX "payments_queue_idx" ON "payments" ("status", "created_at");
```

RLS: **party-read** (`buyer_id`/`seller_id` = `app.user_id`) like `mkt_orders`;
the buyer may INSERT their own row and UPDATE it only while `pending`/`submitted`
(a permissive party policy + a RESTRICTIVE "buyer is self and status not yet
decided" check). **`decided_by`, `status='confirmed'|'rejected'|'refunded'` are
never app-writable** — those are set only by the definers, so `UPDATE` of those
columns is routed out: simplest is to REVOKE `UPDATE` from the app entirely and
give the buyer a small definer `pay_submit_receipt(order_id, reference, receipt_key)`
that flips `pending → submitted` for their own order (mirrors the order state
machine). The platform reads the queue through a definer gated on the finance stamp.

### 3.2 `payouts` — a seller's withdrawal request

```sql
CREATE TABLE "payouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" text,                             -- the tenant the earnings are under (reporting)
    "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "amount_paisa" bigint NOT NULL,               -- requested amount, <= available balance at request
    "status" text NOT NULL DEFAULT 'requested',   -- requested|approved|paid|rejected
    "method_cipher" bytea NOT NULL,               -- encrypted payout details (see §5)
    "method_nonce" bytea NOT NULL,
    "reference" text,                             -- the platform's transfer reference when paid
    "requested_at" timestamptz NOT NULL DEFAULT now(),
    "decided_at" timestamptz,
    "decided_by" uuid
);
CREATE INDEX "payouts_queue_idx" ON "payouts" ("status", "requested_at");
CREATE INDEX "payouts_seller_idx" ON "payouts" ("seller_id", "requested_at");
```

RLS: the seller reads their own; writes (create/decide) go through definers. The
seller's request is a definer (`payout_request`) because it must check the
available balance atomically; the platform's decisions are definers on the stamp.

### 3.3 `disputes` — a buyer's dispute on an order

```sql
CREATE TABLE "disputes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" text NOT NULL,
    "order_id" uuid NOT NULL,
    "buyer_id" uuid NOT NULL,
    "seller_id" uuid NOT NULL,
    "opened_by" uuid NOT NULL,
    "reason" text NOT NULL,
    "status" text NOT NULL DEFAULT 'open',        -- open|resolved
    "resolution" text,                            -- 'refund'|'release'|'split'
    "seller_paisa" bigint,                        -- for a split
    "resolved_by" uuid,
    "opened_at" timestamptz NOT NULL DEFAULT now(),
    "resolved_at" timestamptz
);
CREATE UNIQUE INDEX "disputes_order_uq" ON "disputes" ("order_id");
```

Opening a dispute is a buyer action (the `mkt_order_transition` `disputed` edge
already exists); this table records it. Resolving is a finance definer.

Every one of these tables, and the ledger, is **append-only where it matters** and
has its privileged columns revoked from the app by name, on the 0016/0019 pattern.

---

## 4. The money-moving definers

Signature shape for all: `SECURITY DEFINER`, `SET search_path = public`, first line
`v_admin := auth_finance_admin_for_txn()` (except the two seller-initiated ones,
which key on the order/balance being the caller's own, a data-ownership check).
Idempotency has two layers: (a) the **status guard** — the row must be in the exact
`from` state, so a repeat is a no-op; (b) the **deterministic ledger txn_id** —
`uuid_generate_v5(NS, '<verb>:<id>')` (needs `uuid-ossp`; **Q2: enable it, or carry
an explicit `idempotency_key text UNIQUE` on `ledger_entries`?**), so even a racing
double-call cannot double-post.

Fee/ledger accounts used: `external` (the outside world), `escrow` (held per order),
`seller_payable:<sellerId>`, `platform_fee:platform`. Sign convention: a positive
amount credits the account; each transaction sums to zero.

### 4.1 `finance_confirm_payment(p_payment_id uuid)` → the money enters escrow

- **Auth:** finance stamp (`v_admin`).
- **Precondition:** `payments.status = 'submitted'`. Lock the row `FOR UPDATE`.
- **Effect:** set `status='confirmed', decided_by=v_admin, decided_at=now()`; move the
  order `awaiting_payment → paid` via the existing order-transition path (called as
  the owner, or a dedicated internal helper, so the order log gets its event); post
  the ledger:

```sql
PERFORM money_post_txn(uuid_generate_v5(NS_FIN, 'confirm:' || p_payment_id), jsonb_build_array(
  jsonb_build_object('account','external','subject_type','platform','subject_id','platform',
                     'amount_paisa', -v_amount, 'tenant_id', v_tenant,
                     'ref_type','payment','ref_id', p_payment_id::text),
  jsonb_build_object('account','escrow','subject_type','order','subject_id', v_order_id::text,
                     'amount_paisa', v_amount, 'tenant_id', v_tenant,
                     'ref_type','payment','ref_id', p_payment_id::text)
));
```

- **Idempotency:** the `submitted` guard + the `confirm:<id>` txn_id.
- **Failure modes:** payment not found → refuse; not `submitted` (already confirmed
  / rejected) → no-op code; order not `awaiting_payment` (buyer cancelled) → refuse
  and leave the payment for reject/refund; ledger duplicate (txn already posted) →
  the money_post_txn unique guard raises, caught as "already confirmed".

### 4.2 `finance_reject_payment(p_payment_id uuid, p_reason text)` → no money moved

- **Auth:** finance stamp. **Precondition:** `status='submitted'`.
- **Effect:** `status='rejected'`, record `decided_by`/reason. **No ledger entry**
  (nothing entered escrow). The order stays `awaiting_payment` (buyer can resubmit)
  or is cancelled by policy — **Q3: on reject, cancel the order or let the buyer
  resubmit? I propose leave it awaiting_payment with the rejection reason shown.**
- **Idempotency:** the `submitted` guard. **Failure modes:** not found / not
  submitted → no-op.

### 4.3 `finance_release_on_completion(p_order_id uuid)` → escrow to seller + fee

- **Auth:** this one is triggered by order **completion**, not a human. Two options
  (**Q4**): (a) the buyer's `accept delivery` (order → completed) _also_ releases,
  by having the order-completion path call an internal owner helper
  `money_release_internal(order_id)` (no finance stamp, because completion is the
  buyer's own authorized action and the amount is fixed by the order); or (b) it is
  a finance-admin action. **I propose (a): release is mechanical, not a decision —
  the money simply follows completion — so it should not need a human.** Auto-complete
  (`mkt_order_autocomplete`) calls the same helper.
- **Precondition:** order `completed`, a `confirmed` payment exists, not already
  released (guard: no `release:<orderId>` ledger txn yet).
- **Effect:**

```sql
-- v_amount = payment.amount, v_fee = payment.fee_paisa, v_net = payment.net_paisa
PERFORM money_post_txn(uuid_generate_v5(NS_FIN, 'release:' || p_order_id), jsonb_build_array(
  jsonb_build_object('account','escrow','subject_type','order','subject_id', p_order_id::text,
                     'amount_paisa', -v_amount, 'tenant_id', v_tenant, 'ref_type','mkt_order','ref_id', p_order_id::text),
  jsonb_build_object('account','seller_payable','subject_type','user','subject_id', v_seller::text,
                     'amount_paisa', v_net, 'tenant_id', v_tenant, 'ref_type','mkt_order','ref_id', p_order_id::text),
  jsonb_build_object('account','platform_fee','subject_type','platform','subject_id','platform',
                     'amount_paisa', v_fee, 'tenant_id', v_tenant, 'ref_type','mkt_order','ref_id', p_order_id::text)
));
```

- **Idempotency:** the `release:<orderId>` txn_id (a second completion cannot double
  pay). **Failure modes:** cash order (no payment) → skip cleanly; already released
  → no-op.

### 4.4 `finance_refund(p_order_id uuid, p_reason text)` → escrow back to the buyer

- **Auth:** finance stamp. **Precondition:** a `confirmed` payment, money still in
  escrow (not released), order not already refunded.
- **Effect:** `payments.status='refunded'`; ledger `escrow -A`, `external +A`
  (`refund:<orderId>`). Order → cancelled (via the owner order path).
- **Idempotency:** `refund:<orderId>` txn_id + the payment-status guard.
- **Failure modes:** already released (money is with the seller — a refund then must
  claw back from `seller_payable`, a different, negative-balance-capable path;
  **Q5: allow post-release refunds? I propose no — once released, resolution is a
  dispute/split, not a plain refund**); already refunded → no-op.

### 4.5 `finance_resolve_dispute(p_dispute_id uuid, p_resolution text, p_seller_paisa bigint)`

- **Auth:** finance stamp. **Precondition:** dispute `open`, order `disputed`, money
  in escrow.
- **Effect by resolution:**
  - `refund` → §4.4's entries (all to buyer), dispute `resolved`, order cancelled.
  - `release` → §4.3's entries (all to seller net of fee), order completed.
  - `split` → seller gets `p_seller_paisa` (net of its proportional fee), buyer
    refunded the rest; one balanced transaction:

```sql
-- v_seller_gross = p_seller_paisa; v_seller_fee = feePaisa(v_seller_gross);
-- v_seller_net = v_seller_gross - v_seller_fee; v_buyer_refund = v_amount - v_seller_gross
PERFORM money_post_txn(uuid_generate_v5(NS_FIN, 'split:' || p_dispute_id), jsonb_build_array(
  jsonb_build_object('account','escrow','subject_type','order','subject_id', v_order::text,'amount_paisa', -v_amount, ...),
  jsonb_build_object('account','seller_payable','subject_type','user','subject_id', v_seller::text,'amount_paisa', v_seller_net, ...),
  jsonb_build_object('account','platform_fee','subject_type','platform','subject_id','platform','amount_paisa', v_seller_fee, ...),
  jsonb_build_object('account','external','subject_type','platform','subject_id','platform','amount_paisa', v_buyer_refund, ...)
));
-- invariant: -v_amount + v_seller_net + v_seller_fee + v_buyer_refund == 0
```

- **Validation:** `0 <= p_seller_paisa <= v_amount`. **Idempotency:** `split:<disputeId>`
  txn_id + dispute-status guard. **Failure modes:** amount out of range → refuse;
  already resolved → no-op; already released → refuse.

### 4.6 `payout_request(p_amount_paisa bigint, p_tenant_id text, p_method_cipher bytea, p_method_nonce bytea)`

- **Auth:** the **seller themselves** (`v_user := app.user_id`) — this is a
  data-ownership action (requesting one's own money), not a platform privilege, so it
  does **not** take a finance stamp.
- **Precondition:** `p_amount_paisa > 0` and `<=` the caller's available balance,
  computed from the ledger inside the lock:

```sql
SELECT coalesce(sum(amount_paisa),0) INTO v_available FROM ledger_entries
WHERE account = 'seller_payable' AND subject_type='user' AND subject_id = v_user::text;
IF p_amount_paisa > v_available THEN RAISE EXCEPTION 'insufficient balance' USING ERRCODE='23514'; END IF;
```

- **Effect:** insert a `payouts` row (`requested`) with the encrypted method. **No
  ledger entry yet** — the money moves when the payout is marked paid. To stop a
  seller from requesting the same balance twice, either (Q6) **hold** the amount with
  a ledger entry into a `payout_hold:<sellerId>` account at request time (cleanest —
  the available-balance sum then already excludes held funds), or check the sum of
  outstanding `requested`/`approved` payouts. **I propose the hold entry.**
- **Failure modes:** over balance → refuse; encryption key absent at the app layer →
  the request never reaches here (asserted at boot, §5).

### 4.7 `finance_mark_payout_paid(p_payout_id uuid, p_reference text)` → money leaves

- **Auth:** finance stamp. **Precondition:** payout `requested`/`approved`.
- **Effect:** `status='paid'`, `reference`, `decided_by`; ledger moves the held
  amount out:

```sql
PERFORM money_post_txn(uuid_generate_v5(NS_FIN, 'payout:' || p_payout_id), jsonb_build_array(
  jsonb_build_object('account','payout_hold','subject_type','user','subject_id', v_seller::text,'amount_paisa', -v_amount, ...),
  jsonb_build_object('account','external','subject_type','platform','subject_id','platform','amount_paisa', v_amount, ...)
));
```

(If §4.6 does not use a hold, debit `seller_payable` here instead.) A
`finance_reject_payout` mirror releases the hold back to `seller_payable`.

- **Idempotency:** `payout:<payoutId>` txn_id + status guard. **Failure modes:**
  already paid → no-op; payout not found → refuse.

Every definer, after `money_post_txn`, writes an `audit_log` row (actor = the finance
admin from the stamp, or the seller for the two self-service ones) in the same
transaction, so no money moves without an audit line — the 0019 rule.

---

## 5. `PAYOUT_ENCRYPTION_KEY`

Payout method details (bank account / wallet number, title) are PII the platform
must store but should never keep in plaintext.

- **Key:** a 32-byte key, base64 in `PAYOUT_ENCRYPTION_KEY`, **boot-asserted** — the
  app refuses to start in production if it is missing or not 32 bytes (the
  `MEDIA_DATA_DIR` boot-check pattern in `apps/web/lib/app-env.vars.json`). Generate
  with `openssl rand -base64 32`. Documented in `.env.example`; never committed.
- **Cipher:** AES-256-GCM via Node `crypto` at the **application** layer (not in
  Postgres — the database never holds the key). Encrypt on `payout_request`: a fresh
  12-byte nonce per row, store `method_cipher` (ciphertext ++ auth tag) and
  `method_nonce`. Decrypt only when a finance admin opens the payout to pay it, in
  the platform `/admin` request, and never log the plaintext.
- **Interface:** a small `PayoutSecrets` seam in `@campusos/core` (`seal(plain) ->
{cipher, nonce}` / `open({cipher, nonce}) -> plain`), built from the env key, so
  the vendor/algorithm can change behind the interface (§2). Rotation: support a key
  id prefix so a re-encrypt job can migrate rows; **Q7: single key for launch, or
  key-id from day one?** I propose a key-id byte prefix now, one key in use.
- The DB column is `bytea`; RLS keeps a payout row readable only by its seller and
  the finance definers, and the seller never receives the cipher back (the API omits
  it) — only the platform decrypts it.

---

## 6. Finance admin pages (platform host `/admin`, platform_admin only)

All under the platform host, gated exactly as the existing platform admin area; each
mutating action calls `auth_begin_finance()` then the relevant definer, in one POST.

- **Payments awaiting review** — the `submitted` payments queue: order, buyer,
  amount/fee/net, the receipt image, the buyer's reference. Actions: **Confirm**
  (4.1), **Reject** (4.2). Empty when nothing is pending.
- **Disputes** — `open` disputes: order, both parties, reason, the amount in escrow.
  Action: **Resolve** as refund / release / split (with the seller amount for a
  split) (4.5).
- **Payout requests** — `requested`/`approved` payouts: seller, amount, and the
  decrypted method (shown only on this page, only to the admin, fetched per view).
  Actions: **Mark paid** (with the platform's transfer reference) (4.7), **Reject**.
- **Fees by tenant / month** — read-only: `sum(amount_paisa)` over
  `account='platform_fee'` grouped by `tenant_id` and month, from the ledger. This is
  the platform's revenue report; a definer gated on the finance stamp (or a
  platform-admin read) returns it.
- **Payment instructions settings** — the text the buyer sees at `awaiting_payment`
  (the placeholder shipped in Block 2d): the platform's bank details / instructions,
  edited here, stored in platform config, surfaced by `ManualTransferProvider`.

Tenant admins see **none** of this: finance lives on the platform host, and every
definer keys on the platform finance stamp, not on any tenant role.

---

## 7. Open questions to settle before building (collected)

1. **Authorization anchor** — a platform-global `platform_finance_uses` stamp (my
   proposal) vs reusing each order's tenant-grant use-row.
2. **Idempotency key** — `uuid-ossp` `uuid_generate_v5` on a business key, vs an
   explicit `idempotency_key text UNIQUE` column on `ledger_entries`.
3. **On payment reject** — leave the order `awaiting_payment` (resubmit) vs cancel.
4. **Release trigger** — mechanical, on completion, via an owner helper (my
   proposal) vs a finance-admin action.
5. **Post-release refunds** — disallow (resolution is dispute/split) vs allow a
   claw-back from `seller_payable`.
6. **Payout holds** — a `payout_hold` ledger entry at request time (my proposal) vs
   summing outstanding requests.
7. **Payout key rotation** — key-id prefix from day one (my proposal) vs single key.

Nothing here is built. On your word for the questions above, each definer becomes
one migration with its adversarial §6 review against the written SQL, tables first
(with the by-name revokes and the RLS proven by an integration test that a raw app
write is refused), then the definers, then the finance admin UI, then the
order↔money wiring (confirm sets the order paid; completion releases).
