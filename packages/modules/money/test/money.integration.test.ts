import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActorInTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import { myBalancePaisa, myLedger } from '../src/ledger';

/**
 * The ledger is append-only and double-entry: the application role cannot write it
 * at all, money_post_txn is owner-only and enforces the sum-to-zero invariant and
 * idempotency, and a balance is the sum of a person's own entries (never stored).
 * This suite proves each of those against the concrete SQL (CLAUDE.md 6). It
 * refuses to run on an unsplit database, where the write revoke does not bite.
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
      from pg_class where relname = 'ledger_entries' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole('truncate table "ledger_entries" restart identity cascade');
});

/** Post one balanced transaction as the owner (as a finance definer would). */
async function post(entries: Record<string, unknown>[], txnId = randomUUID()): Promise<string> {
  const json = JSON.stringify(entries).replace(/'/g, "''");
  await runAsMigrationRole(`select money_post_txn('${txnId}'::uuid, '${json}'::jsonb)`);
  return txnId;
}

/** A settled online order: escrow releases into the seller's payable and the fee. */
function releaseEntries(sellerId: string, orderId: string, tenant: string) {
  return [
    {
      account: 'escrow',
      subject_type: 'order',
      subject_id: orderId,
      amount_paisa: -100000,
      tenant_id: tenant,
      ref_type: 'mkt_order',
      ref_id: orderId,
    },
    {
      account: 'seller_payable',
      subject_type: 'user',
      subject_id: sellerId,
      amount_paisa: 90000,
      tenant_id: tenant,
      ref_type: 'mkt_order',
      ref_id: orderId,
    },
    {
      account: 'platform_fee',
      subject_type: 'platform',
      subject_id: 'platform',
      amount_paisa: 10000,
      tenant_id: tenant,
      ref_type: 'mkt_order',
      ref_id: orderId,
    },
  ];
}

describe('ledger append-only guarantees', () => {
  it('refuses every application write of the ledger', async () => {
    if (!split) return;
    const u = await findOrCreateUser({ subject: 'led-w', email: 'led-w@x.test' });
    await runAsMigrationRole(
      `insert into universities (slug,name,timezone) values ('aaa','A','Asia/Karachi') on conflict do nothing`,
    );
    // INSERT is denied.
    await expect(
      withActorInTenant(u.userId, 'aaa', (tx) =>
        tx.execute(sql`insert into ledger_entries (txn_id, account, subject_type, subject_id, amount_paisa)
                       values (gen_random_uuid(), 'seller_payable', 'user', ${u.userId}, 5000)`),
      ),
    ).rejects.toThrow();
    // money_post_txn is owner-only: the application cannot execute it.
    await expect(
      withActorInTenant(u.userId, 'aaa', (tx) =>
        tx.execute(sql`select money_post_txn(gen_random_uuid(), '[]'::jsonb)`),
      ),
    ).rejects.toThrow();
  });

  it('posts a balanced transaction and rejects an unbalanced one', async () => {
    if (!split) return;
    const seller = await findOrCreateUser({ subject: 'led-bal', email: 'led-bal@x.test' });
    const orderId = randomUUID();
    await post(releaseEntries(seller.userId, orderId, 'aaa'));
    const counted = [
      ...(await getDb().execute(sql`select count(*)::int as n from ledger_entries`)),
    ] as { n: number }[];
    expect(counted[0]?.n).toBe(3);

    // An unbalanced set (sum <> 0) is refused.
    let threw = false;
    try {
      await post([
        { account: 'escrow', subject_type: 'order', subject_id: orderId, amount_paisa: -100000 },
        {
          account: 'seller_payable',
          subject_type: 'user',
          subject_id: seller.userId,
          amount_paisa: 90000,
        },
      ]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('rejects a zero-amount entry and a duplicate txn id', async () => {
    if (!split) return;
    const seller = await findOrCreateUser({ subject: 'led-dup', email: 'led-dup@x.test' });
    // Zero amount in an otherwise balanced set is refused.
    let zeroThrew = false;
    try {
      await post([
        { account: 'escrow', subject_type: 'order', subject_id: 'o', amount_paisa: 0 },
        {
          account: 'seller_payable',
          subject_type: 'user',
          subject_id: seller.userId,
          amount_paisa: 0,
        },
      ]);
    } catch {
      zeroThrew = true;
    }
    expect(zeroThrew).toBe(true);

    // The same txn id cannot be posted twice (idempotency for a retried action).
    const txnId = randomUUID();
    await post(releaseEntries(seller.userId, randomUUID(), 'aaa'), txnId);
    let dupThrew = false;
    try {
      await post(releaseEntries(seller.userId, randomUUID(), 'aaa'), txnId);
    } catch {
      dupThrew = true;
    }
    expect(dupThrew).toBe(true);
  });
});

describe('own-row balances', () => {
  it('sums a person their own balance, and hides other people entries', async () => {
    if (!split) return;
    const seller = await findOrCreateUser({ subject: 'led-me', email: 'led-me@x.test' });
    const other = await findOrCreateUser({ subject: 'led-other', email: 'led-other@x.test' });
    await runAsMigrationRole(
      `insert into universities (slug,name,timezone) values ('aaa','A','Asia/Karachi') on conflict do nothing`,
    );
    await post(releaseEntries(seller.userId, randomUUID(), 'aaa'));
    await post(releaseEntries(seller.userId, randomUUID(), 'aaa'));

    // The seller's payable is the sum of their two release entries.
    expect(await myBalancePaisa(seller, 'aaa')).toBe(180000);
    expect((await myLedger(seller, 'aaa')).length).toBe(2);

    // Another user sees none of it (own-row RLS; also they can't read the fee).
    expect(await myBalancePaisa(other, 'aaa')).toBe(0);
    expect(await myLedger(other, 'aaa')).toHaveLength(0);
  });
});
