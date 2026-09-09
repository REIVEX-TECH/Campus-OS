import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
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
import { createRidePost } from '../src/write';
import { acceptRequest, requestSeat } from '../src/seats';
import { ratingsForUser, submitRating } from '../src/ratings';

/**
 * Ratings are written only through the auth_rides_submit_rating definer, which
 * re-verifies the pairing against the completed ride and its accepted seat requests.
 * The app has no direct INSERT. Reads are tenant-wide (public profile). Split-DB only.
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
      from pg_class where relname = 'ride_ratings' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "ride_ratings" restart identity cascade',
    'truncate table "ride_seat_requests" restart identity cascade',
    'truncate table "ride_posts" restart identity cascade',
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

/** A completed ride with `rider` as an accepted passenger of `driver`. */
async function completedRideWith(driver: { userId: string }, rider: { userId: string }) {
  const made = await createRidePost(
    driver,
    'aaa',
    {
      kind: 'offer',
      originText: 'Gate',
      destText: 'Campus',
      departAt: soon(),
      seats: 2,
      womenOnly: false,
    },
    settings,
  );
  if (!made.ok) throw new Error('ride setup');
  const req = await requestSeat(rider, 'aaa', made.value.id);
  if (!req.ok) throw new Error('request setup');
  await acceptRequest(driver, 'aaa', req.value.id);
  // Complete the ride the way the (PR 5) sweep will: an in-tenant update. Not via
  // the migration role — ride_posts is FORCE RLS and the owner is NOBYPASSRLS, so a
  // no-tenant-context update matches zero rows.
  await withTenant('aaa', (tx) =>
    tx.execute(
      sql`update ride_posts set status = 'completed', completed_at = now() where id = ${made.value.id}::uuid`,
    ),
  );
  return made.value.id;
}

describe('ride ratings', () => {
  it('lets both parties rate after completion, one per pairing, on the profile', async () => {
    if (!split) return;
    const driver = await member('rt-driver');
    const rider = await member('rt-rider');
    const rideId = await completedRideWith(driver, rider);

    expect(
      await submitRating(rider, 'aaa', {
        rideId,
        ratee: driver.userId,
        stars: 5,
        direction: 'of_driver',
        comment: 'Smooth ride',
      }),
    ).toMatchObject({ ok: true, value: { created: true } });
    expect(
      await submitRating(driver, 'aaa', {
        rideId,
        ratee: rider.userId,
        stars: 4,
        direction: 'of_passenger',
      }),
    ).toMatchObject({ ok: true, value: { created: true } });

    // One per pairing: a second rating is a no-op.
    expect(
      await submitRating(rider, 'aaa', {
        rideId,
        ratee: driver.userId,
        stars: 1,
        direction: 'of_driver',
      }),
    ).toMatchObject({ ok: true, value: { created: false } });

    const driverProfile = await ratingsForUser('aaa', driver.userId);
    expect(driverProfile.asDriver).toMatchObject({ average: 5, count: 1 });
    expect(driverProfile.recent[0]?.comment).toBe('Smooth ride');
    const riderProfile = await ratingsForUser('aaa', rider.userId);
    expect(riderProfile.asPassenger).toMatchObject({ average: 4, count: 1 });
  });

  it('refuses a non-party, a not-completed ride, self, and a contact-laced comment', async () => {
    if (!split) return;
    const driver = await member('rt-g-driver');
    const rider = await member('rt-g-rider');
    const outsider = await member('rt-g-outsider');

    // Not completed yet.
    const made = await createRidePost(
      driver,
      'aaa',
      {
        kind: 'offer',
        originText: 'Gate',
        destText: 'Campus',
        departAt: soon(),
        seats: 1,
        womenOnly: false,
      },
      settings,
    );
    if (!made.ok) throw new Error('setup');
    const req = await requestSeat(rider, 'aaa', made.value.id);
    if (!req.ok) throw new Error('setup');
    await acceptRequest(driver, 'aaa', req.value.id);
    expect(
      await submitRating(rider, 'aaa', {
        rideId: made.value.id,
        ratee: driver.userId,
        stars: 5,
        direction: 'of_driver',
      }),
    ).toMatchObject({ ok: false, error: 'not_completed' });

    const rideId = await completedRideWith(driver, rider);
    // An outsider was never on the ride.
    expect(
      await submitRating(outsider, 'aaa', {
        rideId,
        ratee: driver.userId,
        stars: 5,
        direction: 'of_driver',
      }),
    ).toMatchObject({ ok: false, error: 'not_eligible' });
    // Cannot rate yourself.
    expect(
      await submitRating(driver, 'aaa', {
        rideId,
        ratee: driver.userId,
        stars: 5,
        direction: 'of_driver',
      }),
    ).toMatchObject({ ok: false, error: 'invalid' });
    // Contact info in a comment is refused before the definer is called.
    expect(
      await submitRating(rider, 'aaa', {
        rideId,
        ratee: driver.userId,
        stars: 5,
        direction: 'of_driver',
        comment: 'text me 0300 1234567',
      }),
    ).toMatchObject({ ok: false, error: 'contact_info' });
  });

  it('does not let the application insert a rating directly', async () => {
    if (!split) return;
    const driver = await member('rt-raw-driver');
    const rider = await member('rt-raw-rider');
    const rideId = await completedRideWith(driver, rider);
    // A raw app insert (bypassing the definer) matches no policy / holds no grant.
    await expect(
      getDb().execute(sql`
        insert into ride_ratings (tenant_id, ride_post_id, rater_id, ratee_id, direction, stars)
        values ('aaa', ${rideId}::uuid, ${rider.userId}::uuid, ${driver.userId}::uuid, 'of_driver', 5)`),
    ).rejects.toThrow();
  });
});
