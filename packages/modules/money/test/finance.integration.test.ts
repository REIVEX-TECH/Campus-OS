import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  withMigrationClient,
} from '@campusos/db/migrate';
import { runBaseMigrations } from '@campusos/db/migrate';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import {
  confirmPayment,
  markPayoutPaid,
  refundOrder,
  rejectPayment,
  requestPayout,
  resolveDispute,
  sellerBalance,
} from '../src/finance';

/**
 * The money movements: confirm -> escrow, release -> seller + fee, refund, dispute
 * split, and payout hold -> paid, each balanced on the ledger and gated on the
 * finance stamp (or the caller's own data). Split-DB only (the app must be a
 * non-owner for the write-lock and stamp guarantees to mean anything).
 */

let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(
    migrationDatabaseUrl(),
    identityManifest.migrations.folder,
    identityManifest.migrations.table,
  );
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'payments' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "ledger_entries","payments","payouts","disputes","platform_roles" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values ('aaa','Alpha U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
});

async function member(subject: string) {
  const actor = await findOrCreateUser({ subject, email: `${subject}@aaa.edu` });
  await ensureDomainMembership(actor, {
    slug: 'aaa',
    joinMode: 'domain' as const,
    allowedEmailDomains: ['aaa.edu'],
  });
  return actor;
}

async function platformAdmin(subject: string) {
  const actor = await member(subject);
  await withMigrationClient(
    (c) =>
      c`insert into platform_roles (user_id, role) values (${actor.userId}::uuid, 'platform_admin')
      on conflict do nothing`,
  );
  return actor;
}

/** Owner-insert a submitted payment (bypassing the order chain) and return its ids. */
async function submittedPayment(
  buyerId: string,
  sellerId: string,
  amount: number,
): Promise<{ paymentId: string; orderId: string; fee: number; net: number }> {
  const fee = Math.floor((amount * 1000) / 10000);
  const net = amount - fee;
  const [row] = await withMigrationClient(
    (c) =>
      c`insert into payments (tenant_id, order_id, buyer_id, seller_id, amount_paisa, fee_paisa, net_paisa, status, submitted_at)
        values ('aaa', gen_random_uuid(), ${buyerId}::uuid, ${sellerId}::uuid, ${amount}, ${fee}, ${net}, 'submitted', now())
        returning id, order_id`,
  );
  return { paymentId: row!.id as string, orderId: row!.order_id as string, fee, net };
}

async function balance(account: string, subjectType: string, subjectId: string): Promise<number> {
  const [row] = await withMigrationClient(
    (c) =>
      c`select coalesce(sum(amount_paisa),0)::bigint as bal from ledger_entries
        where account = ${account} and subject_type = ${subjectType} and subject_id = ${subjectId}`,
  );
  return Number((row as { bal: string }).bal);
}

async function releaseInternal(orderId: string): Promise<void> {
  await withMigrationClient((c) => c`select money_release_internal(${orderId}::uuid)`);
}

describe('finance money movements', () => {
  it('refuses a raw application write to payments, payouts, and disputes', async () => {
    if (!split) return;
    const u = await member('mv-raw');
    await expect(
      getDb().execute(sql`
        insert into payments (tenant_id, order_id, buyer_id, seller_id, amount_paisa, fee_paisa, net_paisa)
        values ('aaa', gen_random_uuid(), ${u.userId}::uuid, ${u.userId}::uuid, 1000, 100, 900)`),
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`
        insert into payouts (seller_id, amount_paisa, method_cipher, method_nonce)
        values (${u.userId}::uuid, 100, '\\x00', '\\x00')`),
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`
        insert into disputes (tenant_id, order_id, buyer_id, seller_id, opened_by, reason)
        values ('aaa', gen_random_uuid(), ${u.userId}::uuid, ${u.userId}::uuid, ${u.userId}::uuid, 'x')`),
    ).rejects.toThrow();
  });

  it('confirms a payment into escrow, then releases to the seller net of the fee', async () => {
    if (!split) return;
    const admin = await platformAdmin('mv-admin');
    const buyer = await member('mv-buyer');
    const seller = await member('mv-seller');
    const { paymentId, orderId, fee, net } = await submittedPayment(
      buyer.userId,
      seller.userId,
      10_000,
    );

    expect(await confirmPayment(admin, paymentId)).toMatchObject({ ok: true });
    expect(await balance('escrow', 'order', orderId)).toBe(10_000);
    expect(await balance('external', 'platform', 'platform')).toBe(-10_000);
    // Idempotent: a second confirm is a no-op refusal, no double ledger.
    expect(await confirmPayment(admin, paymentId)).toMatchObject({ ok: false, error: 'bad_state' });
    expect(await balance('escrow', 'order', orderId)).toBe(10_000);

    await releaseInternal(orderId);
    expect(await balance('escrow', 'order', orderId)).toBe(0);
    expect(await balance('seller_payable', 'user', seller.userId)).toBe(net);
    expect(await balance('platform_fee', 'platform', 'platform')).toBe(fee);
    expect(await sellerBalance(seller)).toBe(net);
    // Releasing again does not double-pay.
    await releaseInternal(orderId);
    expect(await balance('seller_payable', 'user', seller.userId)).toBe(net);
  });

  it('refunds escrow to the buyer before release, and refuses after release', async () => {
    if (!split) return;
    const admin = await platformAdmin('rf-admin');
    const buyer = await member('rf-buyer');
    const seller = await member('rf-seller');
    const { paymentId, orderId } = await submittedPayment(buyer.userId, seller.userId, 5_000);
    await confirmPayment(admin, paymentId);

    expect(await refundOrder(admin, orderId, 'not delivered')).toMatchObject({ ok: true });
    expect(await balance('escrow', 'order', orderId)).toBe(0);
    expect(await balance('external', 'platform', 'platform')).toBe(0); // -5000 (confirm) + 5000 (refund)

    // A released order can no longer be plain-refunded.
    const b = await submittedPayment(buyer.userId, seller.userId, 3_000);
    await confirmPayment(admin, b.paymentId);
    await releaseInternal(b.orderId);
    expect(await refundOrder(admin, b.orderId, 'late')).toMatchObject({
      ok: false,
      error: 'already_released',
    });
  });

  it('holds a payout against the balance and pays it out, refusing an over-request', async () => {
    if (!split) return;
    const admin = await platformAdmin('po-admin');
    const buyer = await member('po-buyer');
    const seller = await member('po-seller');
    const { paymentId, orderId, net } = await submittedPayment(buyer.userId, seller.userId, 10_000);
    await confirmPayment(admin, paymentId);
    await releaseInternal(orderId);
    expect(await sellerBalance(seller)).toBe(net);

    const cipher = Buffer.from([0x01, 0, 0]);
    const nonce = Buffer.alloc(12);
    const req = await requestPayout(seller, 'aaa', {
      amountPaisa: net,
      methodCipher: cipher,
      methodNonce: nonce,
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    // The hold moved the balance out of seller_payable into payout_hold.
    expect(await sellerBalance(seller)).toBe(0);
    expect(await balance('payout_hold', 'user', seller.userId)).toBe(net);
    // A second request for the same money is refused (insufficient balance).
    await expect(
      requestPayout(seller, 'aaa', { amountPaisa: net, methodCipher: cipher, methodNonce: nonce }),
    ).rejects.toThrow();

    expect(await markPayoutPaid(admin, req.value.id, 'TRX-1')).toMatchObject({ ok: true });
    expect(await balance('payout_hold', 'user', seller.userId)).toBe(0);
    expect(await balance('external', 'platform', 'platform')).toBe(0); // -10000 confirm + 10000 payout
  });

  it('splits a dispute: the seller gets their share net of fee, the buyer the rest', async () => {
    if (!split) return;
    const admin = await platformAdmin('dp-admin');
    const buyer = await member('dp-buyer');
    const seller = await member('dp-seller');
    const { paymentId, orderId } = await submittedPayment(buyer.userId, seller.userId, 10_000);
    await confirmPayment(admin, paymentId);
    const [d] = await withMigrationClient(
      (c) =>
        c`insert into disputes (tenant_id, order_id, buyer_id, seller_id, opened_by, reason)
          values ('aaa', ${orderId}::uuid, ${buyer.userId}::uuid, ${seller.userId}::uuid, ${buyer.userId}::uuid, 'partial')
          returning id`,
    );
    const disputeId = (d as { id: string }).id;

    // Seller keeps 6000 gross (fee 600, net 5400); buyer refunded 4000.
    expect(await resolveDispute(admin, disputeId, 'split', 6_000)).toMatchObject({ ok: true });
    expect(await balance('escrow', 'order', orderId)).toBe(0);
    expect(await balance('seller_payable', 'user', seller.userId)).toBe(5_400);
    expect(await balance('platform_fee', 'platform', 'platform')).toBe(600);
  });

  it('refuses a finance action from someone who is not a platform admin', async () => {
    if (!split) return;
    const notAdmin = await member('gate-user');
    const buyer = await member('gate-buyer');
    const seller = await member('gate-seller');
    const { paymentId } = await submittedPayment(buyer.userId, seller.userId, 1_000);
    await expect(confirmPayment(notAdmin, paymentId)).rejects.toThrow();
    // And a reject is equally gated.
    await expect(rejectPayment(notAdmin, paymentId, 'no')).rejects.toThrow();
  });
});
