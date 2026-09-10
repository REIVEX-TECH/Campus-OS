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
import { createRidePost, cancelRide } from '../src/write';
import { acceptRequest, requestSeat, requestsForRide } from '../src/seats';
import {
  createShareLink,
  hasActiveShareLink,
  resolveSharedRide,
  revokeShareLinks,
} from '../src/share';

/**
 * Ride share links: a bearer token resolves to the minimal trip view within its
 * tenant; a random / revoked / expired / cancelled token resolves to nothing. Only
 * the driver or an accepted passenger may create one. Split-DB only.
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
      from pg_class where relname = 'ride_share_tokens' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "ride_share_tokens" restart identity cascade',
    'truncate table "ride_seat_requests" restart identity cascade',
    'truncate table "ride_posts" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'),
       ('bbb','Beta U','Asia/Karachi') on conflict ("slug") do nothing`,
    `select auth_sync_tenant_roles('aaa')`,
    `select auth_sync_tenant_roles('bbb')`,
  );
});

async function member(subject: string, slug = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@${slug}.edu` });
  await ensureDomainMembership(actor, {
    slug,
    joinMode: 'domain' as const,
    allowedEmailDomains: [`${slug}.edu`],
  });
  return actor;
}

const soon = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function makeOffer(driver: { userId: string }, slug = 'aaa') {
  const made = await createRidePost(
    driver,
    slug,
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

describe('rides share links', () => {
  it('lets the driver create a link that resolves to the trip', async () => {
    if (!split) return;
    const driver = await member('sh-driver');
    const rideId = await makeOffer(driver);

    const made = await createShareLink(driver, 'aaa', rideId);
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const view = await resolveSharedRide('aaa', made.value.token);
    expect(view).not.toBeNull();
    expect(view?.originText).toBe('Gate');
    expect(view?.destText).toBe('Campus');
    expect(view?.driverHandle).not.toBeNull();
  });

  it('resolves nothing for an unknown token, and stays scoped to the tenant', async () => {
    if (!split) return;
    const driver = await member('sh-scope-driver');
    const rideId = await makeOffer(driver);
    const made = await createShareLink(driver, 'aaa', rideId);
    if (!made.ok) return;

    expect(await resolveSharedRide('aaa', 'not-a-real-token')).toBeNull();
    // The token is valid, but not on another tenant's page.
    expect(await resolveSharedRide('bbb', made.value.token)).toBeNull();
  });

  it('refuses a non-participant and allows an accepted passenger', async () => {
    if (!split) return;
    const driver = await member('sh-eli-driver');
    const stranger = await member('sh-eli-stranger');
    const passenger = await member('sh-eli-passenger');
    const rideId = await makeOffer(driver);

    // A stranger to the ride cannot create a link.
    expect(await createShareLink(stranger, 'aaa', rideId)).toMatchObject({
      ok: false,
      error: 'not_eligible',
    });

    // A pending passenger is not yet eligible.
    const req = await requestSeat(passenger, 'aaa', rideId);
    if (!req.ok) throw new Error('seat request setup');
    expect(await createShareLink(passenger, 'aaa', rideId)).toMatchObject({
      ok: false,
      error: 'not_eligible',
    });

    // Once accepted, they can.
    const reqs = await requestsForRide(driver, 'aaa', rideId);
    const pending = reqs.find((r) => r.passengerId === passenger.userId);
    if (!pending) throw new Error('no pending request');
    const accepted = await acceptRequest(driver, 'aaa', pending.id);
    expect(accepted.ok).toBe(true);
    expect(await createShareLink(passenger, 'aaa', rideId)).toMatchObject({ ok: true });
  });

  it('stops resolving once the link is revoked', async () => {
    if (!split) return;
    const driver = await member('sh-rev-driver');
    const rideId = await makeOffer(driver);
    const made = await createShareLink(driver, 'aaa', rideId);
    if (!made.ok) return;

    expect(await hasActiveShareLink(driver, 'aaa', rideId)).toBe(true);
    expect(await revokeShareLinks(driver, 'aaa', rideId)).toMatchObject({ ok: true });
    expect(await hasActiveShareLink(driver, 'aaa', rideId)).toBe(false);
    expect(await resolveSharedRide('aaa', made.value.token)).toBeNull();
  });

  it('stops resolving once the link has expired', async () => {
    if (!split) return;
    const driver = await member('sh-exp-driver');
    const rideId = await makeOffer(driver);
    const made = await createShareLink(driver, 'aaa', rideId);
    if (!made.ok) return;

    await runAsMigrationRole(
      `update ride_share_tokens set expires_at = now() - interval '1 hour' where tenant_id = 'aaa'`,
    );
    expect(await resolveSharedRide('aaa', made.value.token)).toBeNull();
  });

  it('stops resolving once the ride is cancelled', async () => {
    if (!split) return;
    const driver = await member('sh-cancel-driver');
    const rideId = await makeOffer(driver);
    const made = await createShareLink(driver, 'aaa', rideId);
    if (!made.ok) return;

    expect(await cancelRide(driver, 'aaa', rideId)).toMatchObject({ ok: true });
    expect(await resolveSharedRide('aaa', made.value.token)).toBeNull();
  });
});
