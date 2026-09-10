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
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { createRidePost } from '../src/write';
import { acceptRequest, requestSeat } from '../src/seats';
import { sweepRides } from '../src/lifecycle';

/**
 * The lifecycle sweep completes rides with an accepted seat past the window, expires
 * the rest, and spawns the next occurrence of a recurring offer through the tenant
 * timezone. The work is an owner-run definer (it reads seat requests across the
 * participant RLS). Split-DB only.
 */

const settings = settingsSchema.parse({});
let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  for (const m of [identityManifest, communitiesManifest]) {
    await applyMigrations(migrationDatabaseUrl(), m.migrations.folder, m.migrations.table);
  }
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'ride_posts' and relkind = 'r'`)),
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

/** Move a ride's departure into the past so the sweep considers it. */
async function backdate(rideId: string, hoursAgo: number) {
  await withTenant('aaa', (tx) =>
    tx.execute(
      sql`update ride_posts set depart_at = now() - make_interval(hours => ${hoursAgo})
          where id = ${rideId}::uuid`,
    ),
  );
}

async function status(rideId: string): Promise<string | null> {
  const [row] = await withTenant('aaa', (tx) =>
    tx.execute(sql`select status from ride_posts where id = ${rideId}::uuid`),
  );
  return (row as { status?: string } | undefined)?.status ?? null;
}

describe('rides lifecycle sweep', () => {
  it('completes a ride with an accepted seat and expires one without', async () => {
    if (!split) return;
    const driver = await member('lc-driver');
    const rider = await member('lc-rider');

    const withSeat = await createRidePost(
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
    const empty = await createRidePost(
      driver,
      'aaa',
      {
        kind: 'offer',
        originText: 'North',
        destText: 'Campus',
        departAt: soon(),
        seats: 2,
        womenOnly: false,
      },
      settings,
    );
    if (!withSeat.ok || !empty.ok) throw new Error('setup');
    const req = await requestSeat(rider, 'aaa', withSeat.value.id);
    if (!req.ok) throw new Error('setup');
    await acceptRequest(driver, 'aaa', req.value.id);

    // Both are now 3h past departure.
    await backdate(withSeat.value.id, 3);
    await backdate(empty.value.id, 3);

    const result = await sweepRides('aaa', { completeAfterHours: 2 });
    expect(result).toMatchObject({ completed: 1, expired: 1, spawned: 0 });
    expect(await status(withSeat.value.id)).toBe('completed');
    expect(await status(empty.value.id)).toBe('expired');
  });

  it('leaves a ride still within the window untouched', async () => {
    if (!split) return;
    const driver = await member('lc-future-driver');
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
    // Departed only 1h ago, window is 2h.
    await backdate(made.value.id, 1);
    const result = await sweepRides('aaa', { completeAfterHours: 2 });
    expect(result).toMatchObject({ completed: 0, expired: 0, spawned: 0 });
    expect(await status(made.value.id)).toBe('active');
  });

  it('spawns the next occurrence of a recurring offer, once', async () => {
    if (!split) return;
    const driver = await member('lc-rec-driver');
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
        recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: '08:00' },
      },
      settings,
    );
    if (!made.ok) throw new Error('setup');
    await backdate(made.value.id, 3);

    const first = await sweepRides('aaa', { completeAfterHours: 2 });
    expect(first.spawned).toBe(1);

    // A child occurrence exists, linked to the root, in the future, still recurring.
    const children = await withTenant('aaa', (tx) =>
      tx.execute(sql`
        select id, depart_at, status, recurrence is not null as recurs
        from ride_posts where recurrence_parent_id = ${made.value.id}::uuid`),
    );
    const rows = [...children] as Array<{
      depart_at: string | Date;
      status: string;
      recurs: boolean;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.recurs).toBe(true);
    expect(new Date(rows[0]!.depart_at).getTime()).toBeGreaterThan(Date.now());

    // Idempotent: a second sweep does not re-spawn (the root already ended; the child
    // is in the future) and touches nothing.
    const second = await sweepRides('aaa', { completeAfterHours: 2 });
    expect(second).toMatchObject({ completed: 0, expired: 0, spawned: 0 });
    const again = await withTenant('aaa', (tx) =>
      tx.execute(sql`select count(*)::int as n from ride_posts
                     where recurrence_parent_id = ${made.value.id}::uuid`),
    );
    expect(([...again][0] as { n: number }).n).toBe(1);
  });
});
