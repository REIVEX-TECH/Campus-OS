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
import { manifest as communitiesManifest } from '@campusos/module-communities/manifest';
import { manifest as notificationsManifest } from '@campusos/module-notifications/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { createRidePost, cancelRide } from '../src/write';
import { ridePost } from '../src/posts';
import {
  acceptRequest,
  cancelSeatRequest,
  declineRequest,
  mySeatRequests,
  requestSeat,
  requestsForRide,
} from '../src/seats';

/**
 * Seat requests are private to the passenger and the ride's author. Accept/decline
 * are the driver's act on their own ride (participant policy, no definer); the seat
 * ledger is decremented atomically and both parties are notified. Split-DB only.
 */

const settings = settingsSchema.parse({});
let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  for (const m of [identityManifest, communitiesManifest, notificationsManifest]) {
    await applyMigrations(migrationDatabaseUrl(), m.migrations.folder, m.migrations.table);
  }
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'ride_seat_requests' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "ride_seat_requests" restart identity cascade',
    'truncate table "ride_posts" restart identity cascade',
    'truncate table "notifications" restart identity cascade',
    'truncate table "user_blocks" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi') on conflict ("slug") do nothing`,
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

const soon = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function makeOffer(driver: { userId: string }, seats = 2) {
  const made = await createRidePost(
    driver,
    'aaa',
    {
      kind: 'offer',
      originText: 'Gate',
      destText: 'Campus',
      departAt: soon(),
      seats,
      womenOnly: false,
    },
    settings,
  );
  if (!made.ok) throw new Error('offer setup failed');
  return made.value.id;
}

describe('ride seat requests', () => {
  it('runs the request -> accept flow, decrements the seat, and notifies both', async () => {
    if (!split) return;
    const driver = await member('s-driver');
    const rider = await member('s-rider');
    const rideId = await makeOffer(driver, 2);

    const req = await requestSeat(rider, 'aaa', rideId);
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    // The driver sees the pending request; the passenger sees their own.
    expect((await requestsForRide(driver, 'aaa', rideId)).map((r) => r.status)).toEqual([
      'pending',
    ]);
    expect((await mySeatRequests(rider, 'aaa')).map((r) => r.status)).toEqual(['pending']);

    const acc = await acceptRequest(driver, 'aaa', req.value.id);
    expect(acc).toMatchObject({ ok: true, value: { seatsAvailable: 1 } });
    expect((await ridePost('aaa', rideId))?.seatsAvailable).toBe(1);
    expect((await mySeatRequests(rider, 'aaa')).map((r) => r.status)).toEqual(['accepted']);

    // Both were notified. Notifications are own-row under RLS, so read each inbox as
    // its recipient (a no-context read returns nothing on a split database).
    const inbox = (userId: string) =>
      withActorInTenant(userId, 'aaa', async (tx) =>
        [
          ...(await tx.execute(
            sql`select kind from notifications where user_id = ${userId}::uuid`,
          )),
        ].map((n) => (n as { kind: string }).kind),
      );
    expect(await inbox(driver.userId)).toContain('rides.seat_requested');
    expect(await inbox(rider.userId)).toContain('rides.seat_accepted');
  });

  it('refuses own ride, an unverified rider, a duplicate, and a blocked pair', async () => {
    if (!split) return;
    const driver = await member('s-guard-driver');
    const rider = await member('s-guard-rider');
    const rideId = await makeOffer(driver, 2);

    expect(await requestSeat(driver, 'aaa', rideId)).toMatchObject({
      ok: false,
      error: 'own_ride',
    });

    const stranger = await findOrCreateUser({ subject: 's-stranger', email: 'x@nope.com' });
    expect(await requestSeat(stranger, 'aaa', rideId)).toMatchObject({
      ok: false,
      error: 'not_verified',
    });

    expect((await requestSeat(rider, 'aaa', rideId)).ok).toBe(true);
    expect(await requestSeat(rider, 'aaa', rideId)).toMatchObject({ ok: false, error: 'exists' });

    // A blocked pair cannot request.
    const blocked = await member('s-blocked');
    await runAsMigrationRole(
      `insert into "user_blocks" ("tenant_id","blocker_id","blocked_id")
         values ('aaa','${driver.userId}','${blocked.userId}')`,
    );
    expect(await requestSeat(blocked, 'aaa', rideId)).toMatchObject({
      ok: false,
      error: 'blocked',
    });
  });

  it('flips to full at zero seats and refuses accept by a non-owner', async () => {
    if (!split) return;
    const driver = await member('s-full-driver');
    const r1 = await member('s-full-r1');
    const outsider = await member('s-full-outsider');
    const rideId = await makeOffer(driver, 1);

    const req = await requestSeat(r1, 'aaa', rideId);
    if (!req.ok) throw new Error('setup');

    // A non-owner cannot accept.
    expect(await acceptRequest(outsider, 'aaa', req.value.id)).toMatchObject({
      ok: false,
      error: 'not_found',
    });

    const acc = await acceptRequest(driver, 'aaa', req.value.id);
    expect(acc).toMatchObject({ ok: true, value: { seatsAvailable: 0 } });
    expect((await ridePost('aaa', rideId))?.status).toBe('full');
    // Accepting again is refused.
    expect(await acceptRequest(driver, 'aaa', req.value.id)).toMatchObject({
      ok: false,
      error: 'not_pending',
    });
  });

  it('returns the seat when a passenger cancels an accepted request', async () => {
    if (!split) return;
    const driver = await member('s-cancel-driver');
    const rider = await member('s-cancel-rider');
    const rideId = await makeOffer(driver, 1);
    const req = await requestSeat(rider, 'aaa', rideId);
    if (!req.ok) throw new Error('setup');
    await acceptRequest(driver, 'aaa', req.value.id);
    expect((await ridePost('aaa', rideId))?.status).toBe('full');

    expect(await cancelSeatRequest(rider, 'aaa', req.value.id)).toMatchObject({
      ok: true,
      value: { changed: true },
    });
    const after = await ridePost('aaa', rideId);
    expect(after?.status).toBe('active');
    expect(after?.seatsAvailable).toBe(1);
  });

  it('declines pending requests when the driver cancels the ride', async () => {
    if (!split) return;
    const driver = await member('s-ridecancel-driver');
    const rider = await member('s-ridecancel-rider');
    const rideId = await makeOffer(driver, 2);
    const req = await requestSeat(rider, 'aaa', rideId);
    if (!req.ok) throw new Error('setup');

    expect(await cancelRide(driver, 'aaa', rideId)).toMatchObject({
      ok: true,
      value: { changed: true },
    });
    expect((await mySeatRequests(rider, 'aaa')).map((r) => r.status)).toEqual(['cancelled']);
  });

  it('lets the driver decline a pending request', async () => {
    if (!split) return;
    const driver = await member('s-decline-driver');
    const rider = await member('s-decline-rider');
    const rideId = await makeOffer(driver, 2);
    const req = await requestSeat(rider, 'aaa', rideId);
    if (!req.ok) throw new Error('setup');

    expect(await declineRequest(driver, 'aaa', req.value.id)).toMatchObject({
      ok: true,
      value: { changed: true },
    });
    expect((await mySeatRequests(rider, 'aaa')).map((r) => r.status)).toEqual(['declined']);
  });
});
