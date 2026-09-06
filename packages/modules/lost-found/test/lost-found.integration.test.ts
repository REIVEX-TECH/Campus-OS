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
import { lostFoundItemPhotos, lostFoundItems } from '../src/schema/lost-found';
import { listItems } from '../src/items';

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
