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
import { marketplaceListingPhotos, marketplaceListings } from '../src/schema/marketplace';
import {
  isListingSaved,
  listingById,
  myListings,
  savedListings,
  sellerActiveListings,
} from '../src/listings';
import {
  addListingPhoto,
  createListing,
  deleteListing,
  extendListing,
  saveListing,
  setListingStatus,
  unsaveListing,
} from '../src/write';
import { expireActiveListings } from '../src/expiry';

/**
 * RLS for the marketplace: a listing is tenant-wide readable (anyone browses) but
 * writable only as yourself, and a photo only onto your own listing. FORCE is on,
 * so the guarantee holds even for the owner. The suite refuses to run on an
 * unsplit database (the RESTRICTIVE policies only bite a non-owner).
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
      from pg_class where relname = 'mkt_listings' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "mkt_saved" restart identity cascade',
    'truncate table "mkt_listing_photos" restart identity cascade',
    'truncate table "mkt_listings" restart identity cascade',
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

function newListing(sellerId: string, tenantId: string, title: string) {
  return {
    tenantId,
    sellerId,
    title,
    pricePaisa: 150000,
    category: 'electronics',
    condition: 'used',
  };
}

describe('marketplace RLS', () => {
  it('lets a member post as themselves and browse tenant-wide, but isolates tenants', async () => {
    if (!split) return;
    const a1 = await member('mk-a1', 'aaa');
    const b1 = await member('mk-b1', 'bbb');

    await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx.insert(marketplaceListings).values(newListing(a1.userId, 'aaa', 'calculator')),
    );
    await withActorInTenant(b1.userId, 'bbb', (tx) =>
      tx.insert(marketplaceListings).values(newListing(b1.userId, 'bbb', 'lamp')),
    );

    // A raw read in aaa's context sees only aaa's rows.
    const aaa = await withTenant('aaa', (tx) =>
      tx.execute(sql`select title from mkt_listings order by title`),
    );
    expect([...aaa].map((r) => (r as { title: string }).title)).toEqual(['calculator']);
  });

  it('refuses posting as another user, or into another tenant', async () => {
    if (!split) return;
    const a1 = await member('mk-self-1', 'aaa');
    const a2 = await member('mk-self-2', 'aaa');

    // seller_id must be the actor (RESTRICTIVE insert-as-self).
    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx.insert(marketplaceListings).values(newListing(a2.userId, 'aaa', 'forged')),
      ),
    ).rejects.toThrow();

    // tenant_id must be the context tenant (tenant_isolation WITH CHECK).
    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx.insert(marketplaceListings).values(newListing(a1.userId, 'bbb', 'cross-tenant')),
      ),
    ).rejects.toThrow();
  });

  it('lets an owner attach a photo, and refuses a photo on someone else’s listing', async () => {
    if (!split) return;
    const a1 = await member('mk-photo-1', 'aaa');
    const a2 = await member('mk-photo-2', 'aaa');

    const [listing] = await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx
        .insert(marketplaceListings)
        .values(newListing(a1.userId, 'aaa', 'headphones'))
        .returning({ id: marketplaceListings.id }),
    );

    // The seller may attach a photo to their own listing.
    await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx.insert(marketplaceListingPhotos).values({
        tenantId: 'aaa',
        listingId: listing!.id,
        storageKey: 'marketplace/ab/one.webp',
        thumbKey: 'marketplace/ab/one_thumb.webp',
        contentType: 'image/webp',
      }),
    );

    // Another member may not attach a photo to that listing.
    await expect(
      withActorInTenant(a2.userId, 'aaa', (tx) =>
        tx.insert(marketplaceListingPhotos).values({
          tenantId: 'aaa',
          listingId: listing!.id,
          storageKey: 'marketplace/ab/two.webp',
          thumbKey: 'marketplace/ab/two_thumb.webp',
          contentType: 'image/webp',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('marketplace listing lifecycle', () => {
  const settings = settingsSchema.parse({});

  async function newListingId(seller: { userId: string }, title = 'phone') {
    const res = await createListing(
      seller,
      'aaa',
      { title, pricePaisa: 250000, priceKind: 'fixed', category: 'electronics', condition: 'used' },
      settings,
    );
    if (!res.ok) throw new Error(`create failed: ${res.error}`);
    return res.value.id;
  }

  it('refuses a phone number in the description, then creates a clean listing', async () => {
    if (!split) return;
    const seller = await member('mk-lc-contact');
    const refused = await createListing(
      seller,
      'aaa',
      {
        title: 'textbook',
        description: 'call me on 0300 1234567',
        pricePaisa: 1000,
        priceKind: 'fixed',
        category: 'textbooks',
        condition: 'used',
      },
      settings,
    );
    expect(refused).toMatchObject({ ok: false, error: 'contact_info' });
    const ok = await createListing(
      seller,
      'aaa',
      {
        title: 'textbook',
        pricePaisa: 1000,
        priceKind: 'fixed',
        category: 'textbooks',
        condition: 'used',
      },
      settings,
    );
    expect(ok.ok).toBe(true);
  });

  it('moves active -> reserved -> sold -> active (relist), only for the seller', async () => {
    if (!split) return;
    const seller = await member('mk-lc-a');
    const other = await member('mk-lc-b');
    const id = await newListingId(seller);

    // A non-seller cannot change status.
    expect((await setListingStatus(other, 'aaa', id, 'reserved')).ok).toBe(true); // ok:true, changed:false
    expect((await listingById('aaa', id))?.status).toBe('active');

    expect((await setListingStatus(seller, 'aaa', id, 'reserved')).ok).toBe(true);
    expect((await listingById('aaa', id))?.status).toBe('reserved');
    expect((await setListingStatus(seller, 'aaa', id, 'sold')).ok).toBe(true);
    const sold = await listingById('aaa', id);
    expect(sold?.status).toBe('sold');
    expect(sold?.soldAt).not.toBeNull();
    // Relist clears the sold stamp.
    expect((await setListingStatus(seller, 'aaa', id, 'active')).ok).toBe(true);
    const relisted = await listingById('aaa', id);
    expect(relisted?.status).toBe('active');
    expect(relisted?.soldAt).toBeNull();
  });

  it('deletes the seller listing and its photo rows, returning the storage keys', async () => {
    if (!split) return;
    const seller = await member('mk-lc-del');
    const id = await newListingId(seller);
    expect(
      (
        await addListingPhoto(
          seller,
          'aaa',
          id,
          {
            storageKey: 'marketplace/de/x.webp',
            thumbKey: 'marketplace/de/x_thumb.webp',
            contentType: 'image/webp',
            width: 10,
            height: 10,
            byteSize: 100,
          },
          settings.maxPhotosPerListing,
        )
      ).ok,
    ).toBe(true);
    const res = await deleteListing(seller, 'aaa', id);
    expect(res.ok && res.value.changed).toBe(true);
    if (res.ok) {
      expect(res.value.photoKeys.sort()).toEqual(
        ['marketplace/de/x.webp', 'marketplace/de/x_thumb.webp'].sort(),
      );
    }
    // Gone from reads and from the seller's own listings.
    expect(await listingById('aaa', id)).toBeNull();
    expect((await myListings(seller.userId, 'aaa')).some((l) => l.id === id)).toBe(false);
  });

  it('expires only overdue active listings; the seller can relist', async () => {
    if (!split) return;
    const seller = await member('mk-lc-exp');
    const overdue = await newListingId(seller, 'overdue');
    const fresh = await newListingId(seller, 'fresh');
    await withTenant('aaa', (tx) =>
      tx.execute(
        sql`update mkt_listings set expires_at = now() - interval '1 hour' where id = ${overdue}::uuid`,
      ),
    );
    const count = await expireActiveListings('aaa');
    expect(count).toBe(1);
    expect((await listingById('aaa', overdue))?.status).toBe('expired');
    expect((await listingById('aaa', fresh))?.status).toBe('active');
    // Relist the expired one.
    expect((await setListingStatus(seller, 'aaa', overdue, 'active')).ok).toBe(true);
    expect((await listingById('aaa', overdue))?.status).toBe('active');
  });

  it('extends an active listing only for its seller', async () => {
    if (!split) return;
    const seller = await member('mk-lc-ext');
    const id = await newListingId(seller);
    const before = await withTenant('aaa', (tx) =>
      tx.execute(sql`select expires_at from mkt_listings where id = ${id}::uuid`),
    );
    const beforeAt = ([...before][0] as { expires_at: string }).expires_at;
    // Force it near expiry, then extend.
    await withTenant('aaa', (tx) =>
      tx.execute(
        sql`update mkt_listings set expires_at = now() + interval '1 day' where id = ${id}::uuid`,
      ),
    );
    expect((await extendListing(seller, 'aaa', id, settings)).ok).toBe(true);
    const after = await withTenant('aaa', (tx) =>
      tx.execute(sql`select expires_at from mkt_listings where id = ${id}::uuid`),
    );
    const afterAt = ([...after][0] as { expires_at: string }).expires_at;
    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(beforeAt).getTime());
  });
});

describe('marketplace saved listings', () => {
  const settings = settingsSchema.parse({});

  async function listingBy(seller: { userId: string }) {
    const res = await createListing(
      seller,
      'aaa',
      {
        title: 'saved item',
        pricePaisa: 500,
        priceKind: 'fixed',
        category: 'other',
        condition: 'used',
      },
      settings,
    );
    if (!res.ok) throw new Error('create failed');
    return res.value.id;
  }

  it('saves and unsaves a listing, private to the saver', async () => {
    if (!split) return;
    const seller = await member('mk-sv-seller');
    const buyer = await member('mk-sv-buyer');
    const other = await member('mk-sv-other');
    const id = await listingBy(seller);

    expect((await saveListing(buyer, 'aaa', id)).ok).toBe(true);
    // Idempotent.
    expect((await saveListing(buyer, 'aaa', id)).ok).toBe(true);
    expect(await isListingSaved(buyer.userId, 'aaa', id)).toBe(true);
    expect((await savedListings(buyer.userId, 'aaa')).map((l) => l.id)).toEqual([id]);

    // Another member's saved list does not see it (own-row RLS).
    expect(await isListingSaved(other.userId, 'aaa', id)).toBe(false);
    expect(await savedListings(other.userId, 'aaa')).toHaveLength(0);

    // Unsave removes it.
    expect((await unsaveListing(buyer, 'aaa', id)).ok).toBe(true);
    expect(await isListingSaved(buyer.userId, 'aaa', id)).toBe(false);
    expect(await savedListings(buyer.userId, 'aaa')).toHaveLength(0);
  });

  it('lists a seller active listings for their profile', async () => {
    if (!split) return;
    const seller = await member('mk-sv-prof');
    const a = await listingBy(seller);
    const b = await listingBy(seller);
    // A sold one is excluded from the profile's active list.
    await setListingStatus(seller, 'aaa', b, 'sold');
    const active = await sellerActiveListings('aaa', seller.userId);
    expect(active.map((l) => l.id).sort()).toEqual([a].sort());
  });
});
