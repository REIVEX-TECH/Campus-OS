import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { buildings, rooms, universities } from '@campusos/db/schema';
import type { NormalizedBatch } from '@campusos/core/ingestion';
import { migrationsFolder } from '../src/manifest';
import { TimetableSink } from '../src/ingestion/sink';
import { timetableEntries } from '../src/schema/entries';
import { unmappedSourceValues } from '../src/schema/ingestion';

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

/** One section, one course, one entry per room name (distinct weekdays so each
 *  is its own slot even when rooms dedup to the same canonical room). */
function batch(roomNames: (string | null)[]): NormalizedBatch {
  return {
    terms: [{ code: 'T1', name: 'Term 1' }],
    departments: [{ code: 'D1', name: 'Dept 1' }],
    programs: [{ code: 'P1', name: 'Program 1', departmentCode: 'D1' }],
    courses: [{ code: 'c1', title: 'Course One' }],
    teachers: [{ name: 'Teacher One' }],
    sections: [{ code: 'S1', name: 'A', programCode: 'P1', termCode: 'T1' }],
    entries: roomNames.map((roomName, i) => ({
      termCode: 'T1',
      sectionCode: 'S1',
      courseCode: 'c1',
      teacherName: 'Teacher One',
      roomName,
      dayOfWeek: (i % 5) + 1,
      startsAt: '08:00',
      endsAt: '09:30',
      kind: 'lecture' as const,
      sourceRef: `ref${i}`,
    })),
    unknowns: [],
  };
}

async function ingest(tenant: string, roomNames: (string | null)[]) {
  const sink = new TimetableSink(tenant);
  const runId = await sink.startRun('test');
  const stats = await sink.persist(batch(roomNames), { runId, source: 'test' });
  await sink.finishRun(runId, 'success', stats);
  return stats;
}

async function currentEntries(tenant: string) {
  return withTenant(tenant, (tx) =>
    tx
      .select({
        id: timetableEntries.id,
        roomId: timetableEntries.roomId,
        roomSource: timetableEntries.roomSource,
        hash: timetableEntries.contentHash,
      })
      .from(timetableEntries)
      .where(isNull(timetableEntries.validTo)),
  );
}

async function roomList(tenant: string) {
  return withTenant(tenant, (tx) =>
    tx
      .select({ id: rooms.id, name: rooms.name, dedupKey: rooms.dedupKey })
      .from(rooms)
      .where(isNull(rooms.deletedAt)),
  );
}

async function pendingRoomCount(tenant: string): Promise<number> {
  const rows = await withTenant(tenant, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(unmappedSourceValues)
      .where(
        and(eq(unmappedSourceValues.kind, 'room'), eq(unmappedSourceValues.status, 'pending')),
      ),
  );
  return Number(rows[0]?.n ?? 0);
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

describe('TimetableSink (room auto-create)', () => {
  it('auto-creates a canonical room from the crawled name and links the entry (no TBA, no pending)', async () => {
    await ingest('aaa', ['Room 25 NB']);
    // Rooms never contribute an unmapped row now; other new dimensions
    // (term/program/section/teacher) still do, so we assert the room-specific
    // signal directly: no pending room, and the entry has a real room.
    expect(await pendingRoomCount('aaa')).toBe(0);

    const entries = await currentEntries('aaa');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.roomId).not.toBeNull();

    const list = await roomList('aaa');
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Room 25 NB'); // display name preserved
    expect(list[0]!.dedupKey).toBe('room-25-nb');
    expect(list[0]!.id).toBe(entries[0]!.roomId);
  });

  it('dedups messy formatting variants to a single room, linking every entry', async () => {
    await ingest('aaa', ['Lab 15 NB', 'LAB-15-NB']);

    const list = await roomList('aaa');
    expect(list).toHaveLength(1); // both variants collapse to one room
    expect(list[0]!.dedupKey).toBe('lab-15-nb');

    const entries = await currentEntries('aaa');
    expect(entries).toHaveLength(2); // distinct slots (different weekdays)
    for (const e of entries) expect(e.roomId).toBe(list[0]!.id);
  });

  it('leaves a genuinely blank source room as TBA (safety valve), creating no room', async () => {
    await ingest('aaa', [null]);
    const entries = await currentEntries('aaa');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.roomId).toBeNull();
    expect(entries[0]!.roomSource).toBeNull();
    expect(await roomList('aaa')).toHaveLength(0);
  });

  it('re-ingest is idempotent: the room is reused and no version churns', async () => {
    await ingest('aaa', ['Room 25 NB']);
    const first = await currentEntries('aaa');

    const stats = await ingest('aaa', ['Room 25 NB']);
    expect(stats.inserted).toBe(0);
    expect(stats.closed).toBe(0);
    expect(stats.unknowns).toBe(0);

    const second = await currentEntries('aaa');
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(first[0]!.id); // same row, not closed + reinserted
    expect(await roomList('aaa')).toHaveLength(1); // no duplicate room
  });

  it('is tenant isolated: a room auto-created for one tenant is invisible to another (RLS)', async () => {
    await ingest('aaa', ['Room 25 NB']);
    await ingest('bbb', ['Room 99 OB']);

    expect((await roomList('aaa')).map((r) => r.name)).toEqual(['Room 25 NB']);
    expect((await roomList('bbb')).map((r) => r.name)).toEqual(['Room 99 OB']);
  });
});

describe('TimetableSink (building inference)', () => {
  async function buildingOf(tenant: string, roomName: string) {
    const rows = await withTenant(tenant, (tx) =>
      tx
        .select({ name: buildings.name, code: buildings.code })
        .from(rooms)
        .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
        .where(and(eq(rooms.name, roomName), isNull(rooms.deletedAt))),
    );
    return rows[0] ?? null;
  }

  it('files a room under the building its trailing block code names', async () => {
    await ingest('aaa', ['Lab 15 NB', 'Lab 18 OB', 'Room 25 NB']);
    expect(await buildingOf('aaa', 'Lab 15 NB')).toEqual({ name: 'NB', code: 'NB' });
    expect(await buildingOf('aaa', 'Room 25 NB')).toEqual({ name: 'NB', code: 'NB' });
    expect(await buildingOf('aaa', 'Lab 18 OB')).toEqual({ name: 'OB', code: 'OB' });
    // One building per code, not one per room.
    const all = await withTenant('aaa', (tx) =>
      tx.select({ code: buildings.code }).from(buildings).where(isNull(buildings.deletedAt)),
    );
    expect(all.filter((b) => b.code === 'NB')).toHaveLength(1);
  });

  it('keeps the safety valve: a name with no code stays unassigned', async () => {
    await ingest('aaa', ['Kitchen Lab']);
    expect(await buildingOf('aaa', 'Kitchen Lab')).toEqual({
      name: 'Unassigned Building',
      code: null,
    });
  });
});
