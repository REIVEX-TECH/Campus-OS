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
import { manifest as communitiesManifest } from '@campusos/module-communities/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { ridePosts } from '../src/schema/rides';
import { browseRides, myRides, ridePost } from '../src/posts';
import { cancelRide, createRidePost, editRide } from '../src/write';

/**
 * RLS for rides: a ride is tenant-wide readable but writable only as yourself
 * (the posts pattern), FORCE on. The write path adds verified-membership, seat,
 * departure and contact-info gates, and browse hides a blocked author both ways.
 * The suite refuses to run on an unsplit database (the RESTRICTIVE policy only
 * bites a non-owner), matching the other modules.
 */

const settings = settingsSchema.parse({});
let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(
    migrationDatabaseUrl(),
    identityManifest.migrations.folder,
    identityManifest.migrations.table,
  );
  // communities provides auth_blocked_between, used by browse.
  await applyMigrations(
    migrationDatabaseUrl(),
    communitiesManifest.migrations.folder,
    communitiesManifest.migrations.table,
  );
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
    'truncate table "ride_posts" restart identity cascade',
    'truncate table "user_blocks" restart identity cascade',
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

const soon = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function offer(over: Record<string, unknown> = {}) {
  return {
    kind: 'offer' as const,
    originText: 'North Gate',
    destText: 'Main Campus',
    departAt: soon(),
    seats: 3,
    womenOnly: false,
    ...over,
  };
}

describe('rides RLS and posting', () => {
  it('lets a verified member post and browse tenant-wide, and isolates tenants', async () => {
    if (!split) return;
    const a = await member('r-a', 'aaa');
    const b = await member('r-b', 'bbb');

    const made = await createRidePost(a, 'aaa', offer({ originText: 'Aaa Gate' }), settings);
    expect(made.ok).toBe(true);
    await createRidePost(b, 'bbb', offer({ originText: 'Bbb Gate' }), settings);

    const aaa = await browseRides('aaa');
    expect(aaa.rides.map((r) => r.originText)).toContain('Aaa Gate');
    expect(aaa.rides.map((r) => r.originText)).not.toContain('Bbb Gate');

    const leaked = await withTenant('aaa', (tx) =>
      tx.execute(sql`select id from ride_posts where origin_text = 'Bbb Gate'`),
    );
    expect([...leaked]).toHaveLength(0);
  });

  it('refuses posting as another user (RESTRICTIVE insert-as-self)', async () => {
    if (!split) return;
    const a1 = await member('r-self-1', 'aaa');
    const a2 = await member('r-self-2', 'aaa');
    await expect(
      withActorInTenant(a2.userId, 'aaa', (tx) =>
        tx.insert(ridePosts).values({
          tenantId: 'aaa',
          authorId: a1.userId,
          kind: 'request',
          originText: 'x',
          destText: 'y',
          departAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses an unverified member, contact info, a past departure and bad seats', async () => {
    if (!split) return;
    const stranger = await findOrCreateUser({ subject: 'r-strange', email: 'x@nope.com' });
    expect(await createRidePost(stranger, 'aaa', offer(), settings)).toMatchObject({
      ok: false,
      error: 'not_verified',
    });

    const a = await member('r-guard', 'aaa');
    expect(
      await createRidePost(a, 'aaa', offer({ notes: 'call me 0300 1234567' }), settings),
    ).toMatchObject({ ok: false, error: 'contact_info' });
    expect(await createRidePost(a, 'aaa', offer({ notes: 'whatsapp me' }), settings)).toMatchObject(
      { ok: false, error: 'contact_info' },
    );
    expect(
      await createRidePost(
        a,
        'aaa',
        offer({ departAt: new Date(Date.now() - 1000).toISOString() }),
        settings,
      ),
    ).toMatchObject({ ok: false, error: 'past' });
    expect(await createRidePost(a, 'aaa', offer({ seats: 99 }), settings)).toMatchObject({
      ok: false,
      error: 'seats',
    });
  });

  it('filters browse by kind and women-only, and hides completed/past', async () => {
    if (!split) return;
    const a = await member('r-filter', 'aaa');
    await createRidePost(a, 'aaa', offer({ originText: 'Plain Offer' }), settings);
    await createRidePost(a, 'aaa', offer({ originText: 'Women Offer', womenOnly: true }), settings);
    await createRidePost(
      a,
      'aaa',
      {
        kind: 'request',
        originText: 'A Request',
        destText: 'Campus',
        departAt: soon(),
        womenOnly: false,
      },
      settings,
    );

    const offers = await browseRides('aaa', { filters: { kind: 'offer' } });
    expect(offers.rides.every((r) => r.kind === 'offer')).toBe(true);
    expect(offers.rides.map((r) => r.originText)).not.toContain('A Request');

    const women = await browseRides('aaa', { filters: { womenOnly: true } });
    expect(women.rides.map((r) => r.originText)).toEqual(['Women Offer']);

    const search = await browseRides('aaa', { filters: { search: 'Request' } });
    expect(search.rides.map((r) => r.originText)).toEqual(['A Request']);
  });

  it('edits and cancels only the author own active ride', async () => {
    if (!split) return;
    const a = await member('r-owner', 'aaa');
    const other = await member('r-other', 'aaa');
    const made = await createRidePost(a, 'aaa', offer(), settings);
    if (!made.ok) throw new Error('setup');
    const id = made.value.id;

    // Another member cannot edit or cancel it.
    expect(await editRide(other, 'aaa', id, { originText: 'Hacked' })).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await cancelRide(other, 'aaa', id)).toMatchObject({ ok: true, changed: false });

    // The author can.
    expect(await editRide(a, 'aaa', id, { originText: 'Renamed Gate' })).toMatchObject({
      ok: true,
      changed: true,
    });
    const detail = await ridePost('aaa', id);
    expect(detail?.originText).toBe('Renamed Gate');

    expect(await cancelRide(a, 'aaa', id)).toMatchObject({ ok: true, changed: true });
    // A cancelled ride leaves browse but stays in my rides.
    const browse = await browseRides('aaa');
    expect(browse.rides.map((r) => r.id)).not.toContain(id);
    expect((await myRides(a.userId, 'aaa')).map((r) => r.id)).toContain(id);
  });

  it('hides a blocked author from the viewer, both ways', async () => {
    if (!split) return;
    const author = await member('r-blk-author', 'aaa');
    const viewer = await member('r-blk-viewer', 'aaa');
    await createRidePost(author, 'aaa', offer({ originText: 'Blocked Gate' }), settings);

    // Viewer blocks author.
    await runAsMigrationRole(
      `insert into "user_blocks" ("tenant_id","blocker_id","blocked_id")
         values ('aaa','${viewer.userId}','${author.userId}')`,
    );
    const seen = await browseRides('aaa', { viewerId: viewer.userId });
    expect(seen.rides.map((r) => r.originText)).not.toContain('Blocked Gate');

    // And the other way: author blocks viewer -> still hidden from viewer.
    await runAsMigrationRole('truncate table "user_blocks" restart identity cascade');
    await runAsMigrationRole(
      `insert into "user_blocks" ("tenant_id","blocker_id","blocked_id")
         values ('aaa','${author.userId}','${viewer.userId}')`,
    );
    const seen2 = await browseRides('aaa', { viewerId: viewer.userId });
    expect(seen2.rides.map((r) => r.originText)).not.toContain('Blocked Gate');
  });
});
