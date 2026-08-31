import { isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import { applyMigrations, runBaseMigrations } from '@campusos/db/migrate';
import { universities } from '@campusos/db/schema';
import type { NormalizedBatch } from '@campusos/core/ingestion';
import { migrationsFolder } from '../src/manifest';
import { TimetableSink } from '../src/ingestion/sink';
import { AdminRoomsRepository } from '../src/repositories/admin-rooms';
import { timetableEntries } from '../src/schema/entries';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const ROOM = 'Room 25 NB';

beforeAll(async () => {
  await runBaseMigrations(DATABASE_URL);
  await applyMigrations(DATABASE_URL, migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

/** A minimal batch with one class in a room that has no canonical room yet. */
function batch(): NormalizedBatch {
  return {
    terms: [{ code: 'T1', name: 'Term 1' }],
    departments: [{ code: 'UNASSIGNED', name: 'Unassigned' }],
    programs: [{ code: 'P1', name: 'Program 1', departmentCode: 'UNASSIGNED' }],
    courses: [{ code: 'c1', title: 'Course One' }],
    teachers: [{ name: 'Teacher One' }],
    sections: [{ code: 'S1', name: 'A', programCode: 'P1', termCode: 'T1' }],
    entries: [
      {
        termCode: 'T1',
        sectionCode: 'S1',
        courseCode: 'c1',
        teacherName: 'Teacher One',
        roomName: ROOM,
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

async function ingest(
  tenant: string,
): Promise<{ inserted: number; closed: number; unknowns: number }> {
  const sink = new TimetableSink(tenant);
  const runId = await sink.startRun('test');
  const stats = await sink.persist(batch(), { runId, source: 'test' });
  await sink.finishRun(runId, 'success', stats);
  return stats;
}

async function currentEntries(tenant: string) {
  return withTenant(tenant, (tx) =>
    tx
      .select({
        id: timetableEntries.id,
        roomId: timetableEntries.roomId,
        hash: timetableEntries.contentHash,
      })
      .from(timetableEntries)
      .where(isNull(timetableEntries.validTo)),
  );
}

async function seedTenant(slug: string): Promise<void> {
  await getDb()
    .insert(universities)
    .values({ slug, name: `U ${slug}`, timezone: 'Asia/Karachi' })
    .onConflictDoNothing();
}

beforeEach(async () => {
  await getDb().execute(sql`truncate table "universities" restart identity cascade`);
  await seedTenant('aaa');
  await seedTenant('bbb');
});

describe('AdminRoomsRepository (room resolution)', () => {
  it('lists a pending room with its blocked-entry count', async () => {
    await ingest('aaa');
    const pending = await new AdminRoomsRepository('aaa').listPendingRooms();
    expect(pending).toEqual([{ rawValue: ROOM, blockedEntries: 1 }]);
  });

  it('resolves a new room: blocked entries flip from TBA to the room, value marked resolved', async () => {
    await ingest('aaa');
    const before = await currentEntries('aaa');
    expect(before).toHaveLength(1);
    expect(before[0]!.roomId).toBeNull();

    const admin = new AdminRoomsRepository('aaa');
    const result = await admin.resolveRoom({ rawValue: ROOM, newRoomName: ROOM });
    expect(result.resolvedEntries).toBe(1);

    const after = await currentEntries('aaa');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id); // same row, updated in place
    expect(after[0]!.roomId).toBe(result.roomId);
    expect(after[0]!.hash).not.toBe(before[0]!.hash); // hash recomputed with room

    expect(await admin.listPendingRooms()).toEqual([]); // no longer pending
  });

  it('map then re-ingest is idempotent: no new versions spawn (content_hash stable)', async () => {
    await ingest('aaa');
    const admin = new AdminRoomsRepository('aaa');
    await admin.resolveRoom({ rawValue: ROOM, newRoomName: ROOM });
    const mapped = await currentEntries('aaa');

    // Re-crawl the identical source. The sink resolves the room (now canonical),
    // computes the same content_hash, and the diff is a no-op.
    const stats = await ingest('aaa');
    expect(stats.inserted).toBe(0);
    expect(stats.closed).toBe(0);
    expect(stats.unknowns).toBe(0); // nothing re-flagged pending (self-heal)

    const after = await currentEntries('aaa');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(mapped[0]!.id); // not closed + reinserted
    expect(after[0]!.hash).toBe(mapped[0]!.hash); // stable through the cycle
  });

  it('self-heals via alias when mapped to a differently named existing room', async () => {
    await ingest('aaa');
    const admin = new AdminRoomsRepository('aaa');
    // Create a canonical room whose NAME differs from the source string (so a
    // re-crawl cannot match by name), then map the source value to it by id.
    const made = await admin.resolveRoom({ rawValue: 'placeholder', newRoomName: 'NB 25' });
    const res = await admin.resolveRoom({ rawValue: ROOM, existingRoomId: made.roomId });
    expect(res.resolvedEntries).toBe(1);

    // Re-crawl: the room resolves through the resolved_id alias, not by name.
    const stats = await ingest('aaa');
    expect(stats.unknowns).toBe(0);
    const after = await currentEntries('aaa');
    expect(after[0]!.roomId).toBe(made.roomId);
  });

  it('is tenant isolated: resolving under one tenant does not touch another (RLS)', async () => {
    await ingest('aaa');
    await ingest('bbb');

    await new AdminRoomsRepository('aaa').resolveRoom({ rawValue: ROOM, newRoomName: ROOM });

    // bbb still has the pending room and its TBA entry.
    expect(await new AdminRoomsRepository('bbb').listPendingRooms()).toEqual([
      { rawValue: ROOM, blockedEntries: 1 },
    ]);
    const bbb = await currentEntries('bbb');
    expect(bbb[0]!.roomId).toBeNull();
  });
});
