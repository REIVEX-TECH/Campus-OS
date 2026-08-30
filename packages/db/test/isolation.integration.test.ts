import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../src/client';
import { runBaseMigrations } from '../src/migrate';
import { createTenantRepositories, universitiesRepository } from '../src/repositories/index';
import { rooms } from '../src/schema/tenant';
import { withTenant } from '../src/tenant-context';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

beforeAll(async () => {
  await runBaseMigrations(DATABASE_URL);
});

beforeEach(async () => {
  // TRUNCATE is not subject to RLS and campusos_app owns the tables.
  await db.execute(
    sql`truncate table "rooms", "buildings", "campuses", "universities" restart identity cascade`,
  );
  await universitiesRepository.upsert({ slug: 'aaa', name: 'Alpha University', timezone: 'UTC' });
  await universitiesRepository.upsert({ slug: 'bbb', name: 'Beta University', timezone: 'UTC' });
});

afterAll(async () => {
  await sqlClient.end();
});

async function seedRoom(tenant: string, roomName: string) {
  const repos = createTenantRepositories(tenant);
  const campus = await repos.campuses.create({ name: `${tenant}-campus` });
  const building = await repos.buildings.create({
    campusId: campus.id,
    name: `${tenant}-building`,
  });
  const room = await repos.rooms.create({ buildingId: building.id, name: roomName });
  return { campus, building, room };
}

describe('cross-tenant isolation (Postgres RLS)', () => {
  it('a tenant sees only its own rows', async () => {
    await seedRoom('aaa', 'A-101');
    await seedRoom('bbb', 'B-101');

    const aRooms = await createTenantRepositories('aaa').rooms.list();
    const bRooms = await createTenantRepositories('bbb').rooms.list();

    expect(aRooms.map((r) => r.name)).toEqual(['A-101']);
    expect(bRooms.map((r) => r.name)).toEqual(['B-101']);
  });

  it('a forged tenant_id filter still returns nothing', async () => {
    await seedRoom('aaa', 'A-101');
    await seedRoom('bbb', 'B-101');

    const forged = await createTenantRepositories('aaa').rooms.listByTenantIdFilter('bbb');
    expect(forged).toEqual([]);

    const forgedOther = await createTenantRepositories('bbb').rooms.listByTenantIdFilter('aaa');
    expect(forgedOther).toEqual([]);
  });

  it('WITH CHECK blocks inserting a row for another tenant', async () => {
    const { building } = await seedRoom('aaa', 'A-101');

    await expect(
      withTenant('aaa', (tx) =>
        tx.insert(rooms).values({ tenantId: 'bbb', buildingId: building.id, name: 'forged' }),
      ),
    ).rejects.toThrow();
  });

  it('no tenant context sees nothing (default deny)', async () => {
    await seedRoom('aaa', 'A-101');
    // db.select outside withTenant → app.tenant_id unset → RLS denies all.
    const leaked = await db.select().from(rooms);
    expect(leaked).toEqual([]);
  });
});
