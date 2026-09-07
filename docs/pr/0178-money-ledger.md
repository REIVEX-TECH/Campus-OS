# feat(money): append-only double-entry ledger

Block 3 (money) part 2: the ledger. A new platform-level module, `@campusos/module-money`,
whose one table is the append-only, double-entry `ledger_entries` and whose one
writer is the `money_post_txn` definer. This is the substrate every money movement
rests on; the finance actions that call it arrive with the platform finance admin.

## What

- **New module** `packages/modules/money` (platform-level: no routes, no nav, no
  tenant settings; tenant admins never see finance). Its own migration folder and
  bookkeeping table `__drizzle_migrations_money`.
- **`ledger_entries`** (migration `0000_money.sql`): append-only, double-entry.
  Every entry belongs to a transaction (`txn_id`) whose signed integer-paisa
  amounts sum to zero, so money is only ever moved between accounts, never created.
  Balances are never stored -- a balance is the sum of an account's entries.
- **`money_post_txn(txn_id, entries jsonb)`**: the single writer. An owner-run
  SECURITY DEFINER that enforces (a) the amounts sum to exactly zero, (b) every
  entry has an account, a subject, and a non-zero amount, and (c) a `txn_id` posts
  at most once (idempotency for a retried finance action). It is **owner-only**:
  revoked from PUBLIC and never granted to the app. The finance actions (confirm a
  payment, release escrow, pay out, refund) will be owner-run definers that call
  it; nothing the application can run reaches it.
- **Reads** (`@campusos/module-money/ledger`): a person reads only their own
  entries (RLS own-read on `subject_type='user' AND subject_id=app.user_id`),
  giving `myBalancePaisa` and `myLedger`. Platform-wide reads are grant-gated
  definers that ship with the finance admin.

## Data & migration impact

New module + migration `0000_money.sql`. Wired into `scripts/migrate-all.ts`, the
root workspace, and the communities DEFINER_INTENT audit (`money_post_txn` = owner).
Additive; rollback = drop the module's table and function. `pnpm-lock.yaml` updated
for the new workspace package.

## Security review (CLAUDE.md 6, 8)

- **The application role cannot write the ledger at all**: `INSERT/UPDATE/DELETE`
  on `ledger_entries` are revoked from `campusos_app` by name (the 0019 / order
  events discipline), and `money_post_txn` is owner-only. The integration test
  proves both against the concrete SQL: a raw app INSERT is refused, and the app
  cannot EXECUTE `money_post_txn`.
- Reads key on `app.user_id` only for **data ownership** (a person's own earnings),
  never for a privilege decision. Every platform-privilege money action (confirming
  a payment, paying out, deciding a refund) is deliberately NOT in this PR: those
  are finance-admin actions that must be gated on a live platform grant use-row
  (unforgeable), and they land with Block 4 -- where they will get the human
  adversarial SQL review CLAUDE.md 6 requires before any production deploy.
- `tenant_id` is a plain immutable slug, not a foreign key, so no tenant lifecycle
  cascade can ever mutate an append-only financial row.

## Tests

`test/money.integration.test.ts` (CI Postgres+RLS): a balanced transaction posts;
an unbalanced one, a zero-amount entry, and a duplicate `txn_id` are refused; the
app cannot write the ledger or execute the writer; and a person sums their own
balance while seeing none of another's entries. Money typecheck and lint pass;
communities typecheck passes.

## Follow-ups

The payments table + manual receipt-upload + confirm/reject, escrow release on
order completion, payouts (with `PAYOUT_ENCRYPTION_KEY`), refunds/splits, and the
platform `/admin` finance surfaces are Block 4 and are designed but not built here;
they are the money movements that call `money_post_txn`. No tenant enables money.
