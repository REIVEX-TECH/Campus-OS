import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The money ledger: append-only, double-entry, the single source of truth for
 * every amount. Balances are never stored -- a balance is the sum of the entries
 * for an account, computed on read. Every entry belongs to a transaction (`txnId`)
 * whose entries sum to zero, so money is only ever moved between accounts, never
 * created or destroyed.
 *
 * The application role cannot write this table at all (revoked in drizzle/0000);
 * every write goes through the owner-run money_post_txn definer, which enforces the
 * sum-to-zero invariant. References to people/orders are plain columns, no
 * cross-module foreign keys: money reacts to an order by its id, it does not import
 * the marketplace schema. Amounts are signed integer paisa (PKR); positive credits
 * the account, negative debits it.
 */

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Groups the entries of one balanced transaction (they sum to zero). */
    txnId: uuid('txn_id').notNull(),
    /** Present for order-related money, so fees can be reported per tenant; null for
     *  platform-only movements. A plain slug (immutable), no FK: an append-only
     *  ledger row must never be mutated by a cascade. */
    tenantId: text('tenant_id'),
    /** The account this entry moves: 'escrow' | 'platform_fee' | 'seller_payable' |
     *  'buyer_settlement' | 'payout' | 'refund' | 'external'. */
    account: text('account').notNull(),
    /** What the account is scoped to: 'user' | 'order' | 'platform'. */
    subjectType: text('subject_type').notNull(),
    /** The scope id (a user id, an order id) or 'platform'. */
    subjectId: text('subject_id').notNull(),
    /** Signed integer paisa (PKR). Positive credits, negative debits. */
    amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
    /** What caused this entry: 'mkt_order' | 'payment' | 'payout' | 'refund'. */
    refType: text('ref_type'),
    refId: text('ref_id'),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_txn_idx').on(t.txnId),
    index('ledger_entries_account_idx').on(t.account, t.subjectType, t.subjectId),
    index('ledger_entries_ref_idx').on(t.refType, t.refId),
    index('ledger_entries_tenant_idx').on(t.tenantId, t.account),
  ],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
