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
import { lostFoundItemPhotos, lostFoundItems } from '../src/schema/lost-found';
import { listItems } from '../src/items';
import { addItemPhoto, createItem, withdrawItem } from '../src/write';
import {
  claimThread,
  confirmClaim,
  listClaimsForItem,
  openClaim,
  sendClaimMessage,
  withdrawClaim,
} from '../src/claims';

/**
 * RLS for Lost & Found: an item is tenant-wide readable but writable only as
 * yourself, and a photo only onto your own item. FORCE is on, so the guarantee
 * holds even for the owner. The suite refuses to run on an unsplit database
 * (the RESTRICTIVE policies only bite a non-owner), matching the other modules.
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
      from pg_class where relname = 'lf_items' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "lf_item_photos" restart identity cascade',
    'truncate table "lf_items" restart identity cascade',
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

function newItem(reporterId: string, tenantId: string, title: string) {
  return {
    tenantId,
    reporterId,
    kind: 'lost',
    title,
    description: '',
    category: 'other',
  };
}

describe('lost & found RLS', () => {
  it('lets a member post as themselves and browse tenant-wide, but isolates tenants', async () => {
    if (!split) return;
    const a1 = await member('lf-a1', 'aaa');
    const b1 = await member('lf-b1', 'bbb');

    await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx.insert(lostFoundItems).values(newItem(a1.userId, 'aaa', 'blue umbrella')),
    );
    await withActorInTenant(b1.userId, 'bbb', (tx) =>
      tx.insert(lostFoundItems).values(newItem(b1.userId, 'bbb', 'black wallet')),
    );

    // Browse is tenant-wide (the tenant context, any member): aaa sees a1's item.
    const aaa = await listItems('aaa');
    expect(aaa.items.map((i) => i.title)).toContain('blue umbrella');
    expect(aaa.items.map((i) => i.title)).not.toContain('black wallet');

    // bbb sees only its own.
    const bbb = await listItems('bbb');
    expect(bbb.items.map((i) => i.title)).toEqual(['black wallet']);

    // A raw read in aaa's context cannot see bbb's rows.
    const leaked = await withTenant('aaa', (tx) =>
      tx.execute(sql`select id from lf_items where title = 'black wallet'`),
    );
    expect([...leaked]).toHaveLength(0);
  });

  it('refuses posting as another user, or into another tenant', async () => {
    if (!split) return;
    const a1 = await member('lf-self-1', 'aaa');
    const a2 = await member('lf-self-2', 'aaa');

    // reporter_id must be the actor (RESTRICTIVE insert-as-self).
    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx.insert(lostFoundItems).values(newItem(a2.userId, 'aaa', 'forged')),
      ),
    ).rejects.toThrow();

    // tenant_id must be the context tenant (tenant_isolation WITH CHECK).
    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx.insert(lostFoundItems).values(newItem(a1.userId, 'bbb', 'cross-tenant')),
      ),
    ).rejects.toThrow();
  });

  it('lets an owner attach a photo, and refuses a photo on someone else’s item', async () => {
    if (!split) return;
    const a1 = await member('lf-photo-1', 'aaa');
    const a2 = await member('lf-photo-2', 'aaa');

    const [item] = await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx
        .insert(lostFoundItems)
        .values(newItem(a1.userId, 'aaa', 'keys'))
        .returning({ id: lostFoundItems.id }),
    );

    // The reporter may attach a photo to their own item.
    await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx.insert(lostFoundItemPhotos).values({
        tenantId: 'aaa',
        itemId: item!.id,
        storageKey: 'lost-found/ab/one.webp',
        thumbKey: 'lost-found/ab/one_thumb.webp',
        contentType: 'image/webp',
      }),
    );

    // Another member may not attach a photo to that item.
    await expect(
      withActorInTenant(a2.userId, 'aaa', (tx) =>
        tx.insert(lostFoundItemPhotos).values({
          tenantId: 'aaa',
          itemId: item!.id,
          storageKey: 'lost-found/ab/two.webp',
          thumbKey: 'lost-found/ab/two_thumb.webp',
          contentType: 'image/webp',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('lost & found write service', () => {
  const settings = settingsSchema.parse({});

  /** A member whose email is off the tenant's domain: joined but not verified. */
  async function unverified(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    await ensureDomainMembership(actor, domain(tenant));
    return actor;
  }

  it('refuses an unverified member and lets a verified one post', async () => {
    if (!split) return;
    const u = await unverified('lf-w-unv', 'aaa');
    const refused = await createItem(
      u,
      'aaa',
      { kind: 'lost', title: 'phone', category: 'electronics' },
      settings,
    );
    expect(refused.ok).toBe(false);

    const v = await member('lf-w-ver', 'aaa');
    const ok = await createItem(
      v,
      'aaa',
      { kind: 'lost', title: 'phone', category: 'electronics' },
      settings,
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects an unknown category', async () => {
    if (!split) return;
    const v = await member('lf-w-cat', 'aaa');
    const res = await createItem(
      v,
      'aaa',
      { kind: 'lost', title: 'thing', category: 'not-a-category' },
      settings,
    );
    expect(res.ok).toBe(false);
  });

  it('adds a photo only for the owner, and withdraws only one’s own item', async () => {
    if (!split) return;
    const owner = await member('lf-w-own', 'aaa');
    const other = await member('lf-w-oth', 'aaa');
    const created = await createItem(
      owner,
      'aaa',
      { kind: 'found', title: 'ring', category: 'other' },
      settings,
    );
    if (!created.ok) throw new Error('create failed');
    const id = created.value.id;
    const photo = {
      storageKey: 'lost-found/aa/x.webp',
      thumbKey: 'lost-found/aa/x_thumb.webp',
      contentType: 'image/webp',
      width: 100,
      height: 100,
      byteSize: 1000,
    };
    expect((await addItemPhoto(owner, 'aaa', id, photo, settings.maxPhotosPerItem)).ok).toBe(true);
    const foreign = await addItemPhoto(
      other,
      'aaa',
      id,
      { ...photo, storageKey: 'lost-found/aa/y.webp', thumbKey: 'lost-found/aa/y_thumb.webp' },
      settings.maxPhotosPerItem,
    );
    expect(foreign.ok).toBe(false);

    const mine = await withdrawItem(owner, 'aaa', id);
    expect(mine.ok && mine.value.changed).toBe(true);

    const another = await createItem(
      owner,
      'aaa',
      { kind: 'lost', title: 'bag', category: 'bags' },
      settings,
    );
    if (!another.ok) throw new Error('create failed');
    const notOwner = await withdrawItem(other, 'aaa', another.value.id);
    expect(notOwner.ok && notOwner.value.changed).toBe(false);
  });
});

describe('lost & found claims', () => {
  const settings = settingsSchema.parse({});

  async function itemBy(reporter: { userId: string }, tenant = 'aaa') {
    const res = await createItem(
      reporter,
      tenant,
      { kind: 'found', title: 'wallet', category: 'other' },
      settings,
    );
    if (!res.ok) throw new Error('create failed');
    return res.value.id;
  }

  async function unverifiedUser(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    await ensureDomainMembership(actor, domain(tenant));
    return actor;
  }

  it('opens a claim only for a verified non-owner on an open item, once', async () => {
    if (!split) return;
    const reporter = await member('lf-c-rep');
    const itemId = await itemBy(reporter);
    expect((await openClaim(reporter, 'aaa', itemId, 'this is mine')).ok).toBe(false);
    const unv = await unverifiedUser('lf-c-unv');
    expect((await openClaim(unv, 'aaa', itemId, 'is it blue')).ok).toBe(false);
    const claimant = await member('lf-c-cl');
    expect((await openClaim(claimant, 'aaa', itemId, 'lost mine last tuesday')).ok).toBe(true);
    expect((await openClaim(claimant, 'aaa', itemId, 'again please')).ok).toBe(false);
  });

  it('keeps a claim and its messages private to the two participants', async () => {
    if (!split) return;
    const reporter = await member('lf-c-rep2');
    const itemId = await itemBy(reporter);
    const claimant = await member('lf-c-cl2');
    const opened = await openClaim(claimant, 'aaa', itemId, 'the black one');
    if (!opened.ok) throw new Error('open failed');
    const stranger = await member('lf-c-str');
    expect((await listClaimsForItem(reporter, 'aaa', itemId)).length).toBe(1);
    expect((await listClaimsForItem(claimant, 'aaa', itemId)).length).toBe(1);
    expect((await listClaimsForItem(stranger, 'aaa', itemId)).length).toBe(0);
    expect((await sendClaimMessage(claimant, 'aaa', opened.value.id, 'any luck')).ok).toBe(true);
    expect((await sendClaimMessage(stranger, 'aaa', opened.value.id, 'give it')).ok).toBe(false);
    expect((await claimThread(reporter, 'aaa', opened.value.id)).length).toBe(1);
    expect((await claimThread(stranger, 'aaa', opened.value.id)).length).toBe(0);
  });

  it('reporter confirm resolves the item and denies the rest; a non-reporter cannot', async () => {
    if (!split) return;
    const reporter = await member('lf-c-rep3');
    const itemId = await itemBy(reporter);
    const a = await member('lf-c-a');
    const b = await member('lf-c-b');
    const ca = await openClaim(a, 'aaa', itemId, 'claim a');
    const cb = await openClaim(b, 'aaa', itemId, 'claim b');
    if (!ca.ok || !cb.ok) throw new Error('open failed');
    expect((await confirmClaim(a, 'aaa', ca.value.id)).ok).toBe(false);
    expect((await confirmClaim(reporter, 'aaa', ca.value.id)).ok).toBe(true);
    const after = await listClaimsForItem(reporter, 'aaa', itemId);
    const byId = Object.fromEntries(after.map((c) => [c.id, c.status]));
    expect(byId[ca.value.id]).toBe('approved');
    expect(byId[cb.value.id]).toBe('denied');
    expect((await withdrawClaim(b, 'aaa', cb.value.id)).ok).toBe(false);
  });
});
