# feat(money): money movements — finance anchor, payments/payouts/disputes, definers

Block E. The money-movement substrate from `docs/design-money-movements.md`: the
platform finance authorization anchor, the payment / payout / dispute tables, and the
definers that move money on the ledger. **Do not merge.** This is the concrete money
SQL and needs the CLAUDE.md §6 adversarial human review before it lands — the two
prior Phase-5 escalations both passed a design review and were caught only on the
implementation.

The seven design questions are decided (see `docs/overnight/DECISIONS.md`, Block E);
Q1 is the platform finance stamp per the standing instruction ("finance grant, not
tenant grant"). Nothing here is enabled; there is no UI and no order wiring yet.

## What

- `packages/modules/money/drizzle/0001_finance_anchor.sql` — `platform_finance_uses`
  - `auth_begin_finance()` (stamps this txid after checking the caller is a
    `platform_admin`) + `auth_finance_admin_for_txn()` (the stamp for this txid, or
    null). Mirrors the identity-0018 tenant-grant use-row: NO FORCE, app rights revoked
    by name, authorization keyed on an unforgeable stamped row (§8).
- `packages/modules/money/drizzle/0002_finance_tables.sql` — `payments`, `payouts`,
  `disputes`. Party-scoped SELECT; every write revoked from `campusos_app` by name
  (all writes go through the definers), like the ledger (0000) and 0019.
- `packages/modules/money/drizzle/0003_finance_definers.sql` — the movers, each
  §6-annotated:
  - self-service (caller's own data, no stamp): `pay_submit_receipt`, `payout_request`
    (posts the hold), `open_dispute`.
  - finance (stamp-gated): `finance_confirm_payment` (→ escrow), `finance_reject_payment`,
    `finance_refund`, `finance_resolve_dispute` (refund / release / split),
    `finance_mark_payout_paid`, `finance_reject_payout`.
  - `money_release_internal` — OWNER-ONLY (revoked from the app by name), mechanical,
    called owner→owner from the order-completion path (wiring deferred).
    All post through `money_post_txn` (owner→owner); idempotent via a deterministic
    `md5('<verb>:'||id)::uuid` txn_id plus the row's from-state guard under `FOR UPDATE`.
- `packages/modules/money/src/finance.ts` — the TS surface (self-service + finance-admin
  wrappers; `withFinance` runs `auth_begin_finance()` then the definer in one txn).
- `packages/modules/money/src/secrets.ts` — `PayoutSecrets` (AES-256-GCM seal/open,
  key-id prefix, `PAYOUT_ENCRYPTION_KEY`, read lazily). `.env.example` documents the key.
- `communities.integration.test.ts` — all 12 new definers declared in `DEFINER_INTENT`
  (11 `app`, `money_release_internal` `owner`).

## Data & migration impact

Three migrations in the money module folder (own bookkeeping table). New tables
`platform_finance_uses`, `payments`, `payouts`, `disputes`; twelve definers. No tenant
flag; money is platform-level and unchanged for every tenant.

## Security review (CLAUDE.md 6, 8) — the point of this PR

- Authorization keys on the finance **stamp** (`auth_finance_admin_for_txn`), a row
  stamped with `pg_current_xact_id()` the caller cannot see, forge, or carry across
  transactions — never on a GUC. The anchor is the identity-0018 pattern verbatim.
- The ledger stays the only truth: every mover calls `money_post_txn` (owner-only),
  which enforces sum-to-zero; the app has no write on `ledger_entries`, `payments`,
  `payouts`, or `disputes` (revoked by name; proven by an integration test that a raw
  app write is refused).
- `money_release_internal` is owner-only: `REVOKE FROM PUBLIC` is not enough, so it is
  revoked from `campusos_app` by name (the db-grants default-EXECUTE footgun), leaving
  only the owner→owner path.
- Please scrutinise: the split-dispute arithmetic and its sum-to-zero invariant; the
  fee rounding (`(amount*1000)/10000`) at confirm/release/split; the idempotency of
  each `md5(...)` txn_id under a racing double-call; and whether the anchor's
  platform-global stamp (Q1) is the right boundary vs a per-tenant grant.

## Tests / verification

`packages/modules/money/test/finance.integration.test.ts` (split-DB): raw app writes
refused; confirm→escrow→release nets the fee; refund before release and refusal after;
dispute split balances (seller net + fee + buyer refund = escrow); payout holds then
pays; a non-platform-admin is refused. `packages/modules/money/test/secrets.test.ts`:
seal/open round-trip, fresh nonce, tamper detection, key validation. `turbo run
typecheck lint test` passes for the touched packages; migrations apply cleanly locally
(unsplit — the RLS/stamp assertions run in CI, which is split).

## Follow-ups (the reviewer's integration points, deliberately not in this PR)

1. **Order↔money wiring:** `finance_confirm_payment` sets the order `paid`; order
   completion calls `money_release_internal`. Both mean editing the live
   `mkt_order_transition` / `mkt_order_autocomplete` definers — done after review.
2. **Finance admin UI** on the platform host: the payments / disputes / payouts queues
   (decrypt-to-pay), and the fees-by-tenant report.
3. **Boot-assert `PAYOUT_ENCRYPTION_KEY`** in production once the finance UI ships.
