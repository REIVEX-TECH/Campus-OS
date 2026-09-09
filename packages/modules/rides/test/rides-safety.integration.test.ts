import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { browseRides } from '../src/posts';
import { dismissReports, moderationQueue, removeRide, reportTarget } from '../src/safety';

/**
 * Rides safety: a ride hides from browse once open reports reach the threshold; the
 * moderator queue and removal are gated on rides.moderate through owner-run definers
 * (empty / refused for anyone without it). Split-DB only.
 */

const settings = settingsSchema.parse({});
const THRESHOLD = settings.reportThreshold;
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
      from pg_class where relname = 'ride_reports' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "ride_reports" restart identity cascade',
    'truncate table "ride_posts" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi') on conflict ("slug") do nothing`,
    `select auth_sync_tenant_roles('aaa')`,
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

/** A verified member upgraded to tenant_admin (holds rides.moderate via 0003). */
async function moderator(subject: string) {
  const actor = await member(subject);
  await runAsMigrationRole(
    `insert into membership_roles (membership_id, role_id, tenant_id, user_id)
       select m.id, r.id, m.tenant_id, m.user_id
       from tenant_memberships m
       join roles r on r.tenant_id = m.tenant_id and r.key = 'tenant_admin'
       where m.tenant_id = 'aaa' and m.user_id = '${actor.userId}'
       on conflict do nothing`,
  );
  return actor;
}

const soon = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function makeOffer(driver: { userId: string }) {
  const made = await createRidePost(
    driver,
    'aaa',
    {
      kind: 'offer',
      originText: 'Gate',
      destText: 'Campus',
      departAt: soon(),
      seats: 3,
      womenOnly: false,
    },
    settings,
  );
  if (!made.ok) throw new Error('offer setup');
  return made.value.id;
}

describe('rides safety', () => {
  it('hides a ride at the report threshold and shows it in the moderator queue', async () => {
    if (!split) return;
    const driver = await member('sf-driver');
    const rideId = await makeOffer(driver);

    // Reports below the threshold do not hide it.
    for (let i = 1; i < THRESHOLD; i++) {
      await reportTarget(await member(`sf-r${i}`), 'aaa', 'ride_post', rideId, 'unsafe', THRESHOLD);
    }
    expect((await browseRides('aaa')).rides.map((r) => r.id)).toContain(rideId);

    // The threshold report hides it from browse.
    await reportTarget(
      await member(`sf-r${THRESHOLD}`),
      'aaa',
      'ride_post',
      rideId,
      'unsafe',
      THRESHOLD,
    );
    expect((await browseRides('aaa')).rides.map((r) => r.id)).not.toContain(rideId);

    // A moderator sees it in the queue; a plain member sees nothing.
    const mod = await moderator('sf-mod');
    const queue = await moderationQueue(mod, 'aaa');
    expect(queue.some((q) => q.targetId === rideId && q.targetType === 'ride_post')).toBe(true);
    expect(await moderationQueue(driver, 'aaa')).toEqual([]);
  });

  it('lets a moderator remove a ride and refuses a non-moderator', async () => {
    if (!split) return;
    const driver = await member('sf-rm-driver');
    const reporter = await member('sf-rm-reporter');
    const rideId = await makeOffer(driver);
    await reportTarget(reporter, 'aaa', 'ride_post', rideId, 'spam', THRESHOLD);

    // A non-moderator cannot remove.
    expect(await removeRide(reporter, 'aaa', rideId, 'nope')).toMatchObject({
      ok: false,
      error: 'not_allowed',
    });

    const mod = await moderator('sf-rm-mod');
    expect(await removeRide(mod, 'aaa', rideId, 'unsafe driver')).toMatchObject({ ok: true });
    expect((await browseRides('aaa')).rides.map((r) => r.id)).not.toContain(rideId);
    // The reports are resolved (the queue no longer shows it).
    expect((await moderationQueue(mod, 'aaa')).some((q) => q.targetId === rideId)).toBe(false);
  });

  it('un-hides a ride when a moderator dismisses its reports', async () => {
    if (!split) return;
    const driver = await member('sf-dm-driver');
    const rideId = await makeOffer(driver);
    for (let i = 0; i < THRESHOLD; i++) {
      await reportTarget(
        await member(`sf-dm-r${i}`),
        'aaa',
        'ride_post',
        rideId,
        'unsafe',
        THRESHOLD,
      );
    }
    expect((await browseRides('aaa')).rides.map((r) => r.id)).not.toContain(rideId);

    const mod = await moderator('sf-dm-mod');
    expect(await dismissReports(mod, 'aaa', 'ride_post', rideId)).toMatchObject({ ok: true });
    expect((await browseRides('aaa')).rides.map((r) => r.id)).toContain(rideId);
    expect(await moderationQueue(mod, 'aaa')).toEqual([]);
  });

  it('queues a report against a person', async () => {
    if (!split) return;
    const reporter = await member('sf-u-reporter');
    const target = await member('sf-u-target');
    expect(
      await reportTarget(
        reporter,
        'aaa',
        'user',
        target.userId,
        'harassment',
        THRESHOLD,
        'in chat',
      ),
    ).toMatchObject({ ok: true });
    const mod = await moderator('sf-u-mod');
    const queue = await moderationQueue(mod, 'aaa');
    expect(queue.some((q) => q.targetType === 'user' && q.targetId === target.userId)).toBe(true);
  });
});
