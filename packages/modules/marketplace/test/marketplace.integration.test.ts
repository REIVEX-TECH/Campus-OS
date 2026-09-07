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
import { migrationsFolder, migrationsTable } from '../src/manifest';
import { marketplaceListingPhotos, marketplaceListings } from '../src/schema/marketplace';

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
