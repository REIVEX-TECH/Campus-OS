import { sql } from 'drizzle-orm';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';

/**
 * The finance surface over the money definers (0001-0003). Self-service actions run
 * in the caller's own context (data ownership); every finance-admin action runs
 * inside a finance transaction: `auth_begin_finance()` writes the platform-admin
 * stamp for the txid, then the money definer self-checks that stamp. Both happen in
 * ONE transaction, so the stamp cannot leak.
 */

export type FinanceRefusal =
  | 'not_found'
  | 'not_buyer'
  | 'bad_state'
  | 'exists'
  | 'invalid'
  | 'already_released'
  | 'insufficient';

function decode(code: string): Result<Record<string, never>, FinanceRefusal> {
  if (code === 'ok' || code === 'released' || code === 'skip' || code === 'noop') return ok({});
  return err(code as FinanceRefusal);
}

async function callText(tx: TenantTransaction, query: ReturnType<typeof sql>): Promise<string> {
  const [row] = [...(await tx.execute(query))] as { result: string }[];
  return row?.result ?? '';
}

/** Run a finance-admin action: stamp the txn as this platform admin, then act. */
function withFinance<T>(
  adminUserId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withActor(adminUserId, async (tx) => {
    await tx.execute(sql`select auth_begin_finance()`);
    return fn(tx);
  });
}

// ── Self-service ────────────────────────────────────────────────────────────────

/** A buyer submits their transfer receipt for an online order. */
export async function submitReceipt(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
  input: { reference?: string; receiptKey?: string },
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const code = await callText(
      tx,
      sql`select pay_submit_receipt(${orderId}::uuid, ${input.reference ?? null}, ${input.receiptKey ?? null}) as result`,
    );
    return decode(code);
  });
}

/** A seller requests a payout of part of their available balance. */
export async function requestPayout(
  actor: { userId: string },
  tenantId: string,
  input: { amountPaisa: number; methodCipher: Buffer; methodNonce: Buffer },
): Promise<Result<{ id: string }, FinanceRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select payout_request(${input.amountPaisa}::bigint, ${tenantId}, ${input.methodCipher}, ${input.methodNonce}) as id`,
      )),
    ] as { id: string }[];
    return ok({ id: row!.id });
  });
}

/** A buyer opens a dispute on their order. */
export async function openDispute(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
  reason: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const code = await callText(
      tx,
      sql`select open_dispute(${orderId}::uuid, ${reason}) as result`,
    );
    return decode(code);
  });
}

/** A seller's available balance (paisa): the sum of their seller_payable entries. */
export async function sellerBalance(actor: { userId: string }): Promise<number> {
  return withActor(actor.userId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select coalesce(sum(amount_paisa), 0)::bigint as balance from ledger_entries
        where account = 'seller_payable' and subject_type = 'user' and subject_id = ${actor.userId}`)),
    ] as { balance: string | number }[];
    return Number(row?.balance ?? 0);
  });
}

// ── Finance admin (platform_admin, gated on the finance stamp) ────────────────────

export async function confirmPayment(
  admin: { userId: string },
  paymentId: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(await callText(tx, sql`select finance_confirm_payment(${paymentId}::uuid) as result`)),
  );
}

export async function rejectPayment(
  admin: { userId: string },
  paymentId: string,
  reason: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(
      await callText(
        tx,
        sql`select finance_reject_payment(${paymentId}::uuid, ${reason}) as result`,
      ),
    ),
  );
}

export async function refundOrder(
  admin: { userId: string },
  orderId: string,
  reason: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(await callText(tx, sql`select finance_refund(${orderId}::uuid, ${reason}) as result`)),
  );
}

export async function resolveDispute(
  admin: { userId: string },
  disputeId: string,
  resolution: 'refund' | 'release' | 'split',
  sellerPaisa?: number,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(
      await callText(
        tx,
        sql`select finance_resolve_dispute(${disputeId}::uuid, ${resolution}, ${sellerPaisa ?? null}::bigint) as result`,
      ),
    ),
  );
}

export async function markPayoutPaid(
  admin: { userId: string },
  payoutId: string,
  reference: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(
      await callText(
        tx,
        sql`select finance_mark_payout_paid(${payoutId}::uuid, ${reference}) as result`,
      ),
    ),
  );
}

export async function rejectPayout(
  admin: { userId: string },
  payoutId: string,
  reason: string,
): Promise<Result<Record<string, never>, FinanceRefusal>> {
  return withFinance(admin.userId, async (tx) =>
    decode(
      await callText(tx, sql`select finance_reject_payout(${payoutId}::uuid, ${reason}) as result`),
    ),
  );
}
