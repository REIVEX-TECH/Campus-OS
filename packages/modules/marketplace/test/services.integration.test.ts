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
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { marketplaceGigPackages, marketplaceGigs } from '../src/schema/services';
import { createGig, deleteGig, setGigStatus } from '../src/services-write';
import { gigById, listGigs, myGigs } from '../src/services-read';

/**
 * RLS for services: a gig (and its packages) is tenant-wide readable (anyone
 * browses) but writable only as yourself, and a package only onto your own gig.
 * FORCE is on, so the guarantee holds even for the owner. The suite refuses to run
 * on an unsplit database (the RESTRICTIVE policies only bite a non-owner).
 */

let split = false;
const settings = settingsSchema.parse({});

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
      from pg_class where relname = 'mkt_gigs' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "mkt_gig_packages" restart identity cascade',
    'truncate table "mkt_gigs" restart identity cascade',
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

function gigInput(overrides: Partial<Parameters<typeof createGig>[2]> = {}) {
  return {
    title: 'I will tutor first-year calculus',
    description: 'One-on-one sessions, worked examples, exam prep.',
    category: 'tutoring',
    packages: [
      {
        tier: 'basic' as const,
        title: 'One hour',
        pricePaisa: 100000,
        deliveryDays: 2,
        revisions: 0,
      },
      {
        tier: 'standard' as const,
        title: 'Three hours',
        pricePaisa: 250000,
        deliveryDays: 5,
        revisions: 1,
      },
    ],
    ...overrides,
  };
}

describe('services RLS', () => {
  it('refuses inserting a gig as another user, or into another tenant', async () => {
    if (!split) return;
    const a1 = await member('gig-self-1', 'aaa');
    const a2 = await member('gig-self-2', 'aaa');

    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx
          .insert(marketplaceGigs)
          .values({ tenantId: 'aaa', sellerId: a2.userId, title: 'forged', category: 'tutoring' }),
      ),
    ).rejects.toThrow();

    await expect(
      withActorInTenant(a1.userId, 'aaa', (tx) =>
        tx
          .insert(marketplaceGigs)
          .values({ tenantId: 'bbb', sellerId: a1.userId, title: 'cross', category: 'tutoring' }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a package on someone else’s gig', async () => {
    if (!split) return;
    const a1 = await member('gig-pkg-1', 'aaa');
    const a2 = await member('gig-pkg-2', 'aaa');
    const [gig] = await withActorInTenant(a1.userId, 'aaa', (tx) =>
      tx
        .insert(marketplaceGigs)
        .values({ tenantId: 'aaa', sellerId: a1.userId, title: 'mine', category: 'tutoring' })
        .returning({ id: marketplaceGigs.id }),
    );
    await expect(
      withActorInTenant(a2.userId, 'aaa', (tx) =>
        tx.insert(marketplaceGigPackages).values({
          tenantId: 'aaa',
          gigId: gig!.id,
          tier: 'basic',
          title: 'sneak',
          pricePaisa: 100,
          deliveryDays: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it('isolates tenants on browse', async () => {
    if (!split) return;
    const a1 = await member('gig-iso-a', 'aaa');
    const b1 = await member('gig-iso-b', 'bbb');
    expect((await createGig(a1, 'aaa', gigInput({ title: 'alpha gig aaaaa' }), settings)).ok).toBe(
      true,
    );
    expect((await createGig(b1, 'bbb', gigInput({ title: 'beta gig bbbbb' }), settings)).ok).toBe(
      true,
    );
    const aaa = await listGigs('aaa');
    expect(aaa.items.map((g) => g.title)).toEqual(['alpha gig aaaaa']);
  });
});

describe('services create + lifecycle', () => {
  it('refuses a phone number in gig text, then creates a clean gig with packages', async () => {
    if (!split) return;
    const seller = await member('gig-contact');
    const refused = await createGig(
      seller,
      'aaa',
      gigInput({ description: 'reach me on 0300 1234567' }),
      settings,
    );
    expect(refused).toMatchObject({ ok: false, error: 'contact_info' });
    const created = await createGig(seller, 'aaa', gigInput(), settings);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detail = await gigById('aaa', created.value.id);
    expect(detail?.packages.map((p) => p.tier)).toEqual(['basic', 'standard']);
    expect(detail?.packages[0]?.pricePaisa).toBe(100000);
  });

  it('refuses duplicate tiers and an over-cap price', async () => {
    if (!split) return;
    const seller = await member('gig-invalid');
    const dupes = await createGig(
      seller,
      'aaa',
      gigInput({
        packages: [
          { tier: 'basic', title: 'a', pricePaisa: 100, deliveryDays: 1, revisions: 0 },
          { tier: 'basic', title: 'b', pricePaisa: 200, deliveryDays: 1, revisions: 0 },
        ],
      }),
      settings,
    );
    expect(dupes).toMatchObject({ ok: false, error: 'invalid' });
    const overCap = await createGig(
      seller,
      'aaa',
      gigInput({
        packages: [
          {
            tier: 'basic',
            title: 'a',
            pricePaisa: settings.maxPackagePricePaisa + 1,
            deliveryDays: 1,
            revisions: 0,
          },
        ],
      }),
      settings,
    );
    expect(overCap).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('pauses and un-pauses only for the seller, and hides paused from browse', async () => {
    if (!split) return;
    const seller = await member('gig-pause');
    const other = await member('gig-pause-other');
    const created = await createGig(seller, 'aaa', gigInput(), settings);
    if (!created.ok) throw new Error('create failed');
    const id = created.value.id;

    // A non-seller cannot pause (ok:true, changed:false).
    expect((await setGigStatus(other, 'aaa', id, 'paused')).ok).toBe(true);
    expect((await gigById('aaa', id))?.status).toBe('active');

    expect((await setGigStatus(seller, 'aaa', id, 'paused')).ok).toBe(true);
    expect((await gigById('aaa', id))?.status).toBe('paused');
    // Paused drops out of browse but stays visible on its own page.
    expect((await listGigs('aaa')).items.some((g) => g.id === id)).toBe(false);
    expect((await gigById('aaa', id))?.id).toBe(id);

    expect((await setGigStatus(seller, 'aaa', id, 'active')).ok).toBe(true);
    expect((await listGigs('aaa')).items.some((g) => g.id === id)).toBe(true);
  });

  it('soft-deletes a gig; it leaves browse, the page, and the seller list', async () => {
    if (!split) return;
    const seller = await member('gig-del');
    const created = await createGig(seller, 'aaa', gigInput(), settings);
    if (!created.ok) throw new Error('create failed');
    const id = created.value.id;
    expect((await deleteGig(seller, 'aaa', id)).ok).toBe(true);
    expect(await gigById('aaa', id)).toBeNull();
    expect((await listGigs('aaa')).items.some((g) => g.id === id)).toBe(false);
    expect((await myGigs(seller.userId, 'aaa')).some((g) => g.id === id)).toBe(false);
  });
});
