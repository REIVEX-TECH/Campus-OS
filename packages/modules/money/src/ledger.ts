import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';

/**
 * Reading the ledger from the application side. A person may read only their own
 * entries (the RLS own-read policy), so these run in the actor's context and return
 * that person's earnings and history. Platform-wide reads (fees by tenant, the
 * platform's own accounts) are grant-gated definers that ship with the finance
 * admin, not here.
 */

export interface LedgerLine {
  id: string;
  txnId: string;
  account: string;
  amountPaisa: number;
  refType: string | null;
  refId: string | null;
  memo: string | null;
  createdAt: Date;
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * The signed balance of one of the caller's own accounts, in paisa, summed from
 * the ledger. Defaults to their seller payable (what the platform owes them).
 */
export async function myBalancePaisa(
  actor: { userId: string },
  tenantId: string,
  account = 'seller_payable',
): Promise<number> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select coalesce(sum(amount_paisa), 0)::bigint as bal
        from ledger_entries
        where subject_type = 'user' and subject_id = ${actor.userId}
          and account = ${account}`)),
    ] as { bal: string | number }[];
    return Number(row?.bal ?? 0);
  });
}

/** The caller's own ledger lines, newest first (their money history). */
export async function myLedger(
  actor: { userId: string },
  tenantId: string,
  limit = 200,
): Promise<LedgerLine[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, txn_id, account, amount_paisa, ref_type, ref_id, memo, created_at
        from ledger_entries
        where subject_type = 'user' and subject_id = ${actor.userId}
        order by created_at desc, id desc
        limit ${limit}`)),
    ] as Array<{
      id: string;
      txn_id: string;
      account: string;
      amount_paisa: string | number;
      ref_type: string | null;
      ref_id: string | null;
      memo: string | null;
      created_at: string | Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      txnId: r.txn_id,
      account: r.account,
      amountPaisa: Number(r.amount_paisa),
      refType: r.ref_type,
      refId: r.ref_id,
      memo: r.memo,
      createdAt: toDate(r.created_at),
    }));
  });
}
