import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { withTenant } from '@campusos/db';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import { getMapForCampus, listPlacements, listPois } from '../src/read';

/**
 * Campus map is tenant-wide public content: reads are tenant-scoped and see only
 * their own tenant (RLS), and management is granted to the tenant_admin template.
 * Split-DB only (the app must be a non-owner for the RLS assertions to mean
 * anything).
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
      from pg_class where relname = 'campus_maps' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "map_pois","building_placements","campus_maps","buildings","campuses","universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'),
       ('bbb','Beta U','Asia/Karachi') on conflict ("slug") do nothing`,
    `select auth_sync_tenant_roles('aaa')`,
    `select auth_sync_tenant_roles('bbb')`,
  );
});

/** Seed a campus + a map for a tenant, returning both ids. App-role writes. */
async function seedMap(slug: string): Promise<{ campusId: string; mapId: string }> {
  return withTenant(slug, async (tx) => {
    const [c] = [
      ...(await tx.execute(sql`
        insert into campuses (tenant_id, name) values (${slug}, 'Main') returning id`)),
    ] as { id: string }[];
    const [m] = [
      ...(await tx.execute(sql`
        insert into campus_maps (tenant_id, campus_id, mode, image_width, image_height)
        values (${slug}, ${c!.id}::uuid, 'image', 1600, 1200) returning id`)),
    ] as { id: string }[];
    return { campusId: c!.id, mapId: m!.id };
  });
}

describe('campus map reads', () => {
  it('grants map.manage to the tenant_admin template and to a synced tenant', async () => {
    if (!split) return;
    const template = [
      ...(await getDb().execute(sql`
        select 1 from role_template_permissions
        where template_key = 'tenant_admin' and permission = 'map.manage'`)),
    ];
    expect(template.length).toBe(1);
    const synced = [
      ...(await getDb().execute(sql`
        select 1 from role_permissions rp
        join roles r on r.id = rp.role_id
        where r.tenant_id = 'aaa' and r.key = 'tenant_admin' and rp.permission = 'map.manage'`)),
    ];
    expect(synced.length).toBe(1);
  });

  it('reads a map only within its own tenant', async () => {
    if (!split) return;
    const { campusId } = await seedMap('aaa');
    const mine = await getMapForCampus('aaa', campusId);
    expect(mine).not.toBeNull();
    expect(mine?.mode).toBe('image');
    expect(mine?.imageWidth).toBe(1600);
    // Another tenant cannot see it (RLS).
    expect(await getMapForCampus('bbb', campusId)).toBeNull();
  });

  it('lists building placements and POIs only within the tenant', async () => {
    if (!split) return;
    const { mapId } = await seedMap('aaa');
    await withTenant('aaa', async (tx) => {
      const [b] = [
        ...(await tx.execute(sql`
          insert into buildings (tenant_id, campus_id, name)
          select 'aaa', c.id, 'Library' from campuses c where c.tenant_id = 'aaa' limit 1
          returning id`)),
      ] as { id: string }[];
      await tx.execute(sql`
        insert into building_placements (tenant_id, map_id, building_id, x, y)
        values ('aaa', ${mapId}::uuid, ${b!.id}::uuid, 0.5, 0.5)`);
      await tx.execute(sql`
        insert into map_pois (tenant_id, map_id, kind, name, x, y)
        values ('aaa', ${mapId}::uuid, 'gate', 'North Gate', 0.1, 0.2)`);
    });

    const placements = await listPlacements('aaa', mapId);
    expect(placements).toHaveLength(1);
    expect(placements[0]!.label).toBe('Library');
    const pois = await listPois('aaa', mapId);
    expect(pois).toHaveLength(1);
    expect(pois[0]!.name).toBe('North Gate');

    // Another tenant sees neither (RLS).
    expect(await listPlacements('bbb', mapId)).toEqual([]);
    expect(await listPois('bbb', mapId)).toEqual([]);
  });
});
