import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
import { getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { buildings, campuses, rooms } from '@campusos/db/schema';
import { migrationsFolder } from '../src/manifest';
import { computeContentHash } from '../src/domain/index';
import { AdminRoomsRepository } from '../src/repositories/admin-rooms';
import { academicTerms, courses, departments, programs, sections } from '../src/schema/catalog';
import { timetableEntries } from '../src/schema/entries';
import { unmappedSourceValues } from '../src/schema/ingestion';

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

/**
 * Seed OLD-world state directly: the redesigned sink no longer produces pending
 * rooms, so we synthesize what a prior crawl left, namely a current TBA entry
 * (room_id null, room_source set) per raw value plus one pending
 * unmapped_source_values row per distinct raw value.
 */
async function seedPendingRooms(tenant: string, rawValues: string[]) {
  return withTenant(tenant, async (tx) => {
    const [dept] = await tx
      .insert(departments)
      .values({ tenantId: tenant, code: 'D1', name: 'Dept 1' })
      .returning();
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId: tenant, code: 'P1', name: 'Program 1', departmentId: dept!.id })
      .returning();
    const [term] = await tx
      .insert(academicTerms)
      .values({ tenantId: tenant, code: 'T1', name: 'Term 1' })
      .returning();
    const [course] = await tx
      .insert(courses)
      .values({ tenantId: tenant, code: 'c1', title: 'Course One' })
      .returning();
    const [sec] = await tx
      .insert(sections)
      .values({ tenantId: tenant, programId: prog!.id, termId: term!.id, name: 'A' })
      .returning();

    for (let i = 0; i < rawValues.length; i += 1) {
      const dayOfWeek = (i % 5) + 1;
      const contentHash = computeContentHash({
        termId: term!.id,
        sectionId: sec!.id,
        courseId: course!.id,
        teacherId: null,
        roomId: null,
        dayOfWeek,
        startsAt: '08:00',
        endsAt: '09:30',
        kind: 'lecture',
      });
      await tx.insert(timetableEntries).values({
        tenantId: tenant,
        termId: term!.id,
        sectionId: sec!.id,
        courseId: course!.id,
        roomId: null,
        dayOfWeek,
        startsAt: '08:00',
        endsAt: '09:30',
        kind: 'lecture',
        roomSource: rawValues[i]!,
        contentHash,
      });
    }
    for (const raw of new Set(rawValues)) {
      await tx
        .insert(unmappedSourceValues)
        .values({ tenantId: tenant, kind: 'room', rawValue: raw });
    }
    return { termId: term!.id, sectionId: sec!.id, courseId: course!.id };
  });
}

/**
 * Old-world state where one slot is BOTH already linked to a canonical room (via
 * the old case-insensitive name match) AND has a second current TBA entry for a
 * different spelling still pending. Relinking the TBA entry would recompute the
 * same hash as the linked one and collide on tt_entries_current_hash_uq.
 */
async function seedNameMatchedPlusPendingVariant(tenant: string) {
  return withTenant(tenant, async (tx) => {
    const [dept] = await tx
      .insert(departments)
      .values({ tenantId: tenant, code: 'D1', name: 'Dept 1' })
      .returning();
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId: tenant, code: 'P1', name: 'Program 1', departmentId: dept!.id })
      .returning();
    const [term] = await tx
      .insert(academicTerms)
      .values({ tenantId: tenant, code: 'T1', name: 'Term 1' })
      .returning();
    const [course] = await tx
      .insert(courses)
      .values({ tenantId: tenant, code: 'c1', title: 'Course One' })
      .returning();
    const [sec] = await tx
      .insert(sections)
      .values({ tenantId: tenant, programId: prog!.id, termId: term!.id, name: 'A' })
      .returning();
    const [campus] = await tx
      .insert(campuses)
      .values({ tenantId: tenant, name: 'Main' })
      .returning();
    const [building] = await tx
      .insert(buildings)
      .values({ tenantId: tenant, campusId: campus!.id, name: 'B' })
      .returning();
    // Existing canonical room, dedup_key NULL (computes to 'room-25-nb').
    const [room] = await tx
      .insert(rooms)
      .values({ tenantId: tenant, buildingId: building!.id, name: 'Room 25 NB' })
      .returning();
    const slot = {
      termId: term!.id,
      sectionId: sec!.id,
      courseId: course!.id,
      teacherId: null as string | null,
      dayOfWeek: 1,
      startsAt: '08:00',
      endsAt: '09:30',
      kind: 'lecture' as const,
    };
    const [e1] = await tx
      .insert(timetableEntries)
      .values({
        tenantId: tenant,
        ...slot,
        roomId: room!.id,
        roomSource: 'ROOM 25 NB',
        contentHash: computeContentHash({ ...slot, roomId: room!.id }),
      })
      .returning({ id: timetableEntries.id });
    await tx.insert(timetableEntries).values({
      tenantId: tenant,
      ...slot,
      roomId: null,
      roomSource: 'Room-25-NB',
      contentHash: computeContentHash({ ...slot, roomId: null }),
    });
    await tx
      .insert(unmappedSourceValues)
      .values({ tenantId: tenant, kind: 'room', rawValue: 'Room-25-NB' });
    return { roomId: room!.id, e1: e1!.id };
  });
}

async function currentEntries(tenant: string) {
  return withTenant(tenant, (tx) =>
    tx
      .select({
        id: timetableEntries.id,
        roomId: timetableEntries.roomId,
        hash: timetableEntries.contentHash,
        dayOfWeek: timetableEntries.dayOfWeek,
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
  // universities is platform-admin-write under RLS (0017); the owner seeds it.
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone")
     values ('${slug}', 'U ${slug}', 'Asia/Karachi') on conflict ("slug") do nothing`,
  );
}

beforeEach(async () => {
  await runAsMigrationRole(`truncate table "universities" restart identity cascade`);
  await seedTenant('aaa');
  await seedTenant('bbb');
});

describe('AdminRoomsRepository.backfillRooms', () => {
  it('creates the room, relinks the TBA entry in place, and marks the value resolved', async () => {
    const seed = await seedPendingRooms('aaa', ['Room 25 NB']);
    const before = await currentEntries('aaa');
    expect(before).toHaveLength(1);
    expect(before[0]!.roomId).toBeNull();
    expect(await pendingRoomCount('aaa')).toBe(1);

    const result = await new AdminRoomsRepository('aaa').backfillRooms();
    expect(result.roomsCreated).toBe(1);
    expect(result.entriesRelinked).toBe(1);
    expect(result.pendingResolved).toBe(1);

    const list = await roomList('aaa');
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Room 25 NB');
    expect(list[0]!.dedupKey).toBe('room-25-nb');

    const after = await currentEntries('aaa');
    expect(after[0]!.id).toBe(before[0]!.id); // updated in place
    expect(after[0]!.roomId).toBe(list[0]!.id);
    // The recomputed hash equals what an ingest would compute for the slot with
    // the room attached, so a following ingest is a no-op (no version churn).
    expect(after[0]!.hash).toBe(
      computeContentHash({
        termId: seed.termId,
        sectionId: seed.sectionId,
        courseId: seed.courseId,
        teacherId: null,
        roomId: list[0]!.id,
        dayOfWeek: after[0]!.dayOfWeek,
        startsAt: '08:00',
        endsAt: '09:30',
        kind: 'lecture',
      }),
    );

    expect(await pendingRoomCount('aaa')).toBe(0);
  });

  it('dedups messy pending variants to one room and relinks all their entries', async () => {
    await seedPendingRooms('aaa', ['Lab 15 NB', 'LAB-15-NB']);

    const result = await new AdminRoomsRepository('aaa').backfillRooms();
    expect(result.roomsCreated).toBe(1); // both variants -> one canonical room
    expect(result.entriesRelinked).toBe(2);
    expect(result.pendingResolved).toBe(2);

    const list = await roomList('aaa');
    expect(list).toHaveLength(1);
    expect(list[0]!.dedupKey).toBe('lab-15-nb');
    const after = await currentEntries('aaa');
    expect(after).toHaveLength(2);
    for (const e of after) expect(e.roomId).toBe(list[0]!.id);
    expect(await pendingRoomCount('aaa')).toBe(0);
  });

  it('closes a duplicate TBA entry instead of colliding when the slot is already linked', async () => {
    const seed = await seedNameMatchedPlusPendingVariant('aaa');

    const result = await new AdminRoomsRepository('aaa').backfillRooms();
    expect(result.roomsCreated).toBe(0); // the room already existed
    expect(result.entriesRelinked).toBe(0);
    expect(result.entriesClosed).toBe(1); // the duplicate TBA entry, not a crash
    expect(result.pendingResolved).toBe(1);

    const current = await currentEntries('aaa');
    expect(current).toHaveLength(1); // only the already-linked entry remains current
    expect(current[0]!.id).toBe(seed.e1);
    expect(current[0]!.roomId).toBe(seed.roomId);
    expect(await pendingRoomCount('aaa')).toBe(0);
  });

  it('is idempotent: a second run creates nothing and resolves nothing', async () => {
    await seedPendingRooms('aaa', ['Room 25 NB']);
    await new AdminRoomsRepository('aaa').backfillRooms();

    const second = await new AdminRoomsRepository('aaa').backfillRooms();
    expect(second.roomsCreated).toBe(0);
    expect(second.entriesRelinked).toBe(0);
    expect(second.pendingResolved).toBe(0);
    expect(await roomList('aaa')).toHaveLength(1);
  });

  it('is tenant isolated: backfilling one tenant leaves another pending (RLS)', async () => {
    await seedPendingRooms('aaa', ['Room 25 NB']);
    await seedPendingRooms('bbb', ['Room 25 NB']);

    await new AdminRoomsRepository('aaa').backfillRooms();

    expect(await pendingRoomCount('aaa')).toBe(0);
    expect(await pendingRoomCount('bbb')).toBe(1);
    const bbb = await currentEntries('bbb');
    expect(bbb[0]!.roomId).toBeNull();
    expect(await roomList('bbb')).toHaveLength(0);
  });
});

describe('AdminRoomsRepository buildings', () => {
  it('moves an unassigned room into the building its name declares, once', async () => {
    await seedPendingRooms('aaa', ['Lab 15 NB']);
    const repo = new AdminRoomsRepository('aaa');
    // First run creates the room; with inference it lands in NB directly.
    const first = await repo.backfillRooms();
    expect(first.roomsCreated).toBe(1);

    // Simulate a room that predates inference: put it back in the placeholder.
    await withTenant('aaa', async (tx) => {
      const [placeholder] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(eq(buildings.name, 'Unassigned Building'));
      const [room] = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.name, 'Lab 15 NB'));
      if (!placeholder) {
        const [campus] = await tx.select({ id: campuses.id }).from(campuses).limit(1);
        const [made] = await tx
          .insert(buildings)
          .values({ tenantId: 'aaa', campusId: campus!.id, name: 'Unassigned Building' })
          .returning({ id: buildings.id });
        await tx.update(rooms).set({ buildingId: made!.id }).where(eq(rooms.id, room!.id));
      } else {
        await tx.update(rooms).set({ buildingId: placeholder.id }).where(eq(rooms.id, room!.id));
      }
    });

    const second = await repo.backfillRooms();
    expect(second.buildingsAssigned).toBe(1);
    const list = await repo.listBuildings();
    expect(list.find((b) => b.code === 'NB')?.roomCount).toBe(1);

    // Idempotent: nothing left to move.
    expect((await repo.backfillRooms()).buildingsAssigned).toBe(0);
  });

  it('renames a building without touching its code', async () => {
    await seedPendingRooms('aaa', ['Lab 18 OB']);
    const repo = new AdminRoomsRepository('aaa');
    await repo.backfillRooms();
    const ob = (await repo.listBuildings()).find((b) => b.code === 'OB');
    expect(ob).toBeDefined();
    expect(await repo.renameBuilding(ob!.id, '  Old Block ')).toEqual({
      id: ob!.id,
      name: 'Old Block',
    });
    expect(await repo.renameBuilding(ob!.id, '   ')).toBeNull();
    const after = (await repo.listBuildings()).find((b) => b.id === ob!.id);
    expect(after).toMatchObject({ name: 'Old Block', code: 'OB' });
  });

  it("is tenant isolated: one tenant cannot rename another tenant's building", async () => {
    await seedPendingRooms('aaa', ['Lab 18 OB']);
    await new AdminRoomsRepository('aaa').backfillRooms();
    const ob = (await new AdminRoomsRepository('aaa').listBuildings()).find((b) => b.code === 'OB');
    expect(await new AdminRoomsRepository('bbb').renameBuilding(ob!.id, 'Stolen')).toBeNull();
  });
});
