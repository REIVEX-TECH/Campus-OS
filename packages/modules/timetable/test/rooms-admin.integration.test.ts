import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { universities } from '@campusos/db/schema';
import type { NormalizedBatch } from '@campusos/core/ingestion';
import { migrationsFolder } from '../src/manifest';
import { TimetableSink } from '../src/ingestion/sink';
import { AdminRoomsRepository } from '../src/repositories/admin-rooms';

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

function batch(roomName: string): NormalizedBatch {
  return {
    terms: [{ code: 'T1', name: 'Term 1' }],
    departments: [{ code: 'D1', name: 'Dept 1' }],
    programs: [{ code: 'P1', name: 'Program 1', departmentCode: 'D1' }],
    courses: [{ code: 'c1', title: 'Course One' }],
    teachers: [{ name: 'Teacher One' }],
    sections: [{ code: 'S1', name: 'A', programCode: 'P1', termCode: 'T1' }],
    entries: [
      {
        termCode: 'T1',
        sectionCode: 'S1',
        courseCode: 'c1',
        teacherName: 'Teacher One',
        roomName,
        dayOfWeek: 1,
        startsAt: '08:00',
        endsAt: '09:30',
        kind: 'lecture',
        sourceRef: 'ref1',
      },
    ],
    unknowns: [],
  };
}

async function ingest(tenant: string, roomName: string): Promise<void> {
  const sink = new TimetableSink(tenant);
  const runId = await sink.startRun('test');
  const stats = await sink.persist(batch(roomName), { runId, source: 'test' });
  await sink.finishRun(runId, 'success', stats);
}

async function seedTenant(slug: string): Promise<void> {
  await getDb()
    .insert(universities)
    .values({ slug, name: `U ${slug}`, timezone: 'Asia/Karachi' })
    .onConflictDoNothing();
}

beforeEach(async () => {
  await runAsMigrationRole(`truncate table "universities" restart identity cascade`);
  await seedTenant('aaa');
  await seedTenant('bbb');
});

describe('AdminRoomsRepository (read-mostly list + rename)', () => {
  it('lists auto-created rooms with building, capacity, and class count', async () => {
    await ingest('aaa', 'Room 25 NB');
    const list = await new AdminRoomsRepository('aaa').listRooms();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Room 25 NB',
      buildingName: 'NB',
      capacity: null,
      entryCount: 1,
    });
  });

  it('renames the display name without touching the dedup key, so a re-crawl reuses the room', async () => {
    await ingest('aaa', 'Room 25 NB');
    const admin = new AdminRoomsRepository('aaa');
    const id = (await admin.listRooms())[0]!.id;

    const renamed = await admin.renameRoom(id, '  NB   Room 25 ');
    expect(renamed).toEqual({ id, name: 'NB Room 25' }); // trimmed + collapsed

    // Re-crawl the ORIGINAL source string: it dedups to the same room (the match
    // key is unchanged), so no duplicate is created and the new name sticks.
    await ingest('aaa', 'Room 25 NB');
    const list = await admin.listRooms();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('NB Room 25');
  });

  it('returns null for an unknown room or a blank name', async () => {
    const admin = new AdminRoomsRepository('aaa');
    expect(await admin.renameRoom('00000000-0000-0000-0000-000000000000', 'X')).toBeNull();
    await ingest('aaa', 'Room 25 NB');
    const id = (await admin.listRooms())[0]!.id;
    expect(await admin.renameRoom(id, '   ')).toBeNull();
  });

  it('is tenant isolated: renaming in one tenant does not touch another (RLS)', async () => {
    await ingest('aaa', 'Room 25 NB');
    await ingest('bbb', 'Room 25 NB');
    const adminA = new AdminRoomsRepository('aaa');
    await adminA.renameRoom((await adminA.listRooms())[0]!.id, 'Renamed A');

    expect((await adminA.listRooms())[0]!.name).toBe('Renamed A');
    expect((await new AdminRoomsRepository('bbb').listRooms())[0]!.name).toBe('Room 25 NB');
  });

  it('backfill reports zero duplicate keys once rooms are deduped', async () => {
    await ingest('aaa', 'Room 25 NB');
    const result = await new AdminRoomsRepository('aaa').backfillRooms();
    expect(result.duplicateKeys).toBe(0);
  });
});
