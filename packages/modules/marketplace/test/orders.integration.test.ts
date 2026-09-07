import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActorInTenant, withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { createGig } from '../src/services-write';
import { gigById } from '../src/services-read';
import { placeOrder, transitionOrder, writeReview } from '../src/orders-write';
import { listMyOrders, orderById, reviewsForGig } from '../src/orders-read';

/**
 * The order lifecycle is the security core of services: status moves ONLY through
 * the mkt_order_transition definer (locked row, party check, appended event), the
 * order is created ONLY through mkt_place_order (server-derived snapshot), and the
 * application role cannot write mkt_orders / mkt_order_events at all. This suite
 * proves the happy paths, the illegal edges, party isolation, and -- the point of
 * CLAUDE.md 8 -- that a raw application write of status or an event is refused. It
 * refuses to run on an unsplit database, where those revokes do not bite.
 */

let split = false;
const settings = settingsSchema.parse({});

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
      from pg_class where relname = 'mkt_orders' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "mkt_reviews" restart identity cascade',
    'truncate table "mkt_order_events" restart identity cascade',
    'truncate table "mkt_orders" restart identity cascade',
    'truncate table "mkt_gig_packages" restart identity cascade',
    'truncate table "mkt_gigs" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'), ('bbb','Beta U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
});

const domain = (slug: string) => ({
  slug,
  joinMode: 'domain' as const,
  allowedEmailDomains: [`${slug}.edu`],
});

async function member(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@${tenant}.edu` });
  await ensureDomainMembership(actor, domain(tenant));
  return actor;
}

async function gigWithPackage(seller: { userId: string }, tenant = 'aaa', revisions = 0) {
  const res = await createGig(
    seller,
    tenant,
    {
      title: 'I will design a poster',
      description: 'A clean poster for your event.',
      category: 'design-and-art',
      packages: [
        { tier: 'basic', title: 'One poster', pricePaisa: 200000, deliveryDays: 3, revisions },
      ],
    },
    settings,
  );
  if (!res.ok) throw new Error(`gig create failed: ${res.error}`);
  const detail = await gigById(tenant, res.value.id);
  return { gigId: res.value.id, packageId: detail!.packages[0]!.id };
}

async function newOrder(
  buyer: { userId: string },
  gigId: string,
  packageId: string,
  paymentMode: 'cash' | 'online' = 'cash',
) {
  const res = await placeOrder(buyer, 'aaa', { gigId, packageId, paymentMode });
  if (!res.ok) throw new Error(`place failed: ${res.error}`);
  return res.value.id;
}

describe('order placement', () => {
  it('snapshots the package price and refuses ordering your own gig', async () => {
    if (!split) return;
    const seller = await member('ord-place-seller');
    const buyer = await member('ord-place-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);

    // The seller cannot order their own gig.
    expect(await placeOrder(seller, 'aaa', { gigId, packageId })).toMatchObject({
      ok: false,
      error: 'own_gig',
    });

    const id = await newOrder(buyer, gigId, packageId);
    const order = await orderById(buyer, 'aaa', id);
    expect(order?.pricePaisa).toBe(200000); // from the package, not the caller
    expect(order?.status).toBe('requested');
    // The opening event is logged.
    expect(order?.events.map((e) => e.toStatus)).toEqual(['requested']);
  });

  it('refuses an order from a non-member', async () => {
    if (!split) return;
    const seller = await member('ord-nm-seller');
    const stranger = await findOrCreateUser({ subject: 'ord-stranger', email: 'x@nowhere.test' });
    const { gigId, packageId } = await gigWithPackage(seller);
    expect(await placeOrder(stranger, 'aaa', { gigId, packageId })).toMatchObject({
      ok: false,
      error: 'not_verified',
    });
  });
});

describe('order state machine', () => {
  it('runs the cash happy path: requested -> in_progress -> delivered -> completed', async () => {
    if (!split) return;
    const seller = await member('ord-cash-seller');
    const buyer = await member('ord-cash-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'cash');

    // Cash accept goes straight to in_progress (no payment step).
    expect((await transitionOrder(seller, 'aaa', id, 'in_progress')).ok).toBe(true);
    expect((await orderById(buyer, 'aaa', id))?.status).toBe('in_progress');
    expect((await transitionOrder(seller, 'aaa', id, 'delivered')).ok).toBe(true);
    expect((await transitionOrder(buyer, 'aaa', id, 'completed')).ok).toBe(true);
    const done = await orderById(buyer, 'aaa', id);
    expect(done?.status).toBe('completed');
    expect(done?.events.map((e) => e.toStatus)).toEqual([
      'requested',
      'in_progress',
      'delivered',
      'completed',
    ]);
    // Each party sees the order in their own list, in the right role.
    expect((await listMyOrders(buyer, 'aaa', 'buyer')).map((o) => o.id)).toContain(id);
    expect((await listMyOrders(seller, 'aaa', 'seller')).map((o) => o.id)).toContain(id);
    expect((await listMyOrders(buyer, 'aaa', 'seller')).map((o) => o.id)).not.toContain(id);
  });

  it('runs the online path through awaiting_payment and paid', async () => {
    if (!split) return;
    const seller = await member('ord-on-seller');
    const buyer = await member('ord-on-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'online');

    // Online cannot skip payment: seller cannot go straight to in_progress.
    expect((await transitionOrder(seller, 'aaa', id, 'in_progress')).ok).toBe(true);
    expect((await orderById(buyer, 'aaa', id))?.status).toBe('requested'); // 'illegal', no change

    const r1 = await transitionOrder(seller, 'aaa', id, 'awaiting_payment');
    expect(r1.ok && r1.value.outcome).toBe('ok');
    expect((await transitionOrder(buyer, 'aaa', id, 'paid')).ok).toBe(true);
    expect((await transitionOrder(seller, 'aaa', id, 'in_progress')).ok).toBe(true);
    expect((await orderById(buyer, 'aaa', id))?.status).toBe('in_progress');
  });

  it('rejects illegal edges and the wrong actor', async () => {
    if (!split) return;
    const seller = await member('ord-il-seller');
    const buyer = await member('ord-il-buyer');
    const stranger = await member('ord-il-stranger');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'cash');

    // Buyer cannot accept (seller-only edge).
    expect((await transitionOrder(buyer, 'aaa', id, 'in_progress')).ok).toBe(true);
    let r = await transitionOrder(buyer, 'aaa', id, 'in_progress');
    expect(r.ok && r.value.outcome).toBe('illegal');
    // A stranger is not a party.
    r = await transitionOrder(stranger, 'aaa', id, 'cancelled');
    expect(r.ok && r.value.outcome).toBe('not_party');
    // Seller cannot complete (buyer-only).
    await transitionOrder(seller, 'aaa', id, 'in_progress');
    await transitionOrder(seller, 'aaa', id, 'delivered');
    r = await transitionOrder(seller, 'aaa', id, 'completed');
    expect(r.ok && r.value.outcome).toBe('illegal');
  });

  it('allows one revision when the package includes one, then refuses a second', async () => {
    if (!split) return;
    const seller = await member('ord-rev-seller');
    const buyer = await member('ord-rev-buyer');
    const { gigId, packageId } = await gigWithPackage(seller, 'aaa', 1);
    const id = await newOrder(buyer, gigId, packageId, 'cash');
    await transitionOrder(seller, 'aaa', id, 'in_progress');
    await transitionOrder(seller, 'aaa', id, 'delivered');
    // Buyer requests a revision: back to in_progress.
    expect((await transitionOrder(buyer, 'aaa', id, 'in_progress')).ok).toBe(true);
    expect((await orderById(buyer, 'aaa', id))?.status).toBe('in_progress');
    expect((await orderById(buyer, 'aaa', id))?.revisionsUsed).toBe(1);
    // Deliver again; the buyer has no revision left.
    await transitionOrder(seller, 'aaa', id, 'delivered');
    const r = await transitionOrder(buyer, 'aaa', id, 'in_progress');
    expect(r.ok && r.value.outcome).toBe('illegal');
  });
});

describe('append-only and RLS guarantees', () => {
  it('refuses a raw application write of order status or an event', async () => {
    if (!split) return;
    const seller = await member('ord-raw-seller');
    const buyer = await member('ord-raw-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'cash');

    // The application role may not UPDATE an order's status directly.
    await expect(
      withActorInTenant(seller.userId, 'aaa', (tx) =>
        tx.execute(sql`update mkt_orders set status = 'completed' where id = ${id}::uuid`),
      ),
    ).rejects.toThrow();
    // ...nor insert an event by hand.
    await expect(
      withActorInTenant(seller.userId, 'aaa', (tx) =>
        tx.execute(sql`insert into mkt_order_events (tenant_id, order_id, to_status, kind)
                       values ('aaa', ${id}::uuid, 'completed', 'transition')`),
      ),
    ).rejects.toThrow();
    // The order is untouched.
    expect((await orderById(buyer, 'aaa', id))?.status).toBe('requested');
  });

  it('keeps an order and its events private to the two parties', async () => {
    if (!split) return;
    const seller = await member('ord-priv-seller');
    const buyer = await member('ord-priv-buyer');
    const nosy = await member('ord-priv-nosy');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'cash');

    expect(await orderById(seller, 'aaa', id)).not.toBeNull();
    expect(await orderById(buyer, 'aaa', id)).not.toBeNull();
    // A third member sees nothing (RLS party policy).
    expect(await orderById(nosy, 'aaa', id)).toBeNull();
    const events = await withActorInTenant(nosy.userId, 'aaa', (tx) =>
      tx.execute(sql`select count(*)::int as n from mkt_order_events where order_id = ${id}::uuid`),
    );
    expect(([...events][0] as { n: number }).n).toBe(0);
  });
});

describe('reviews and auto-complete', () => {
  it('lets only the buyer review a completed order, once', async () => {
    if (!split) return;
    const seller = await member('ord-rvw-seller');
    const buyer = await member('ord-rvw-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);
    const id = await newOrder(buyer, gigId, packageId, 'cash');

    // Cannot review before completion.
    expect(await writeReview(buyer, 'aaa', id, { rating: 5 })).toMatchObject({
      ok: false,
      error: 'not_completed',
    });
    await transitionOrder(seller, 'aaa', id, 'in_progress');
    await transitionOrder(seller, 'aaa', id, 'delivered');
    await transitionOrder(buyer, 'aaa', id, 'completed');
    // The seller cannot review their own order.
    expect(await writeReview(seller, 'aaa', id, { rating: 1 })).toMatchObject({
      ok: false,
      error: 'not_buyer',
    });
    expect((await writeReview(buyer, 'aaa', id, { rating: 5, body: 'great' })).ok).toBe(true);
    // One per order.
    expect(await writeReview(buyer, 'aaa', id, { rating: 4 })).toMatchObject({
      ok: false,
      error: 'exists',
    });
    const summary = await reviewsForGig('aaa', gigId);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(5);
    expect((await gigById('aaa', gigId))?.ratingCount).toBe(1);
  });

  it('auto-completes a delivered order past the window, not a fresh one', async () => {
    if (!split) return;
    const seller = await member('ord-ac-seller');
    const buyer = await member('ord-ac-buyer');
    const { gigId, packageId } = await gigWithPackage(seller);
    const stale = await newOrder(buyer, gigId, packageId, 'cash');
    const fresh = await newOrder(buyer, gigId, packageId, 'cash');
    for (const id of [stale, fresh]) {
      await transitionOrder(seller, 'aaa', id, 'in_progress');
      await transitionOrder(seller, 'aaa', id, 'delivered');
    }
    // Age the stale one past the window.
    await runAsMigrationRole(
      `update mkt_orders set delivered_at = now() - interval '10 days' where id = '${stale}'`,
    );
    const rows = await withTenant('aaa', (tx) =>
      tx.execute(sql`select mkt_order_autocomplete('aaa', 7) as n`),
    );
    const n = ([...rows][0] as { n: number }).n;
    expect(Number(n)).toBe(1);
    expect((await orderById(buyer, 'aaa', stale))?.status).toBe('completed');
    expect((await orderById(buyer, 'aaa', fresh))?.status).toBe('delivered');
  });
});
