import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import { applyMigrations, runBaseMigrations } from '@campusos/db/migrate';
import { buildings, campuses, rooms, universities } from '@campusos/db/schema';
import { migrationsFolder } from '../src/manifest';
import { createTimetableQueries } from '../src/read/queries';
import {
  academicTerms,
  courses,
  departments,
  programs,
  sections,
  teachers,
} from '../src/schema/catalog';
import { timetableEntries } from '../src/schema/entries';
import { ingestionRuns } from '../src/schema/ingestion';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

beforeAll(async () => {
  await runBaseMigrations(DATABASE_URL);
  await applyMigrations(DATABASE_URL, migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

async function seed() {
  await getDb().execute(sql`truncate table "universities" restart identity cascade`);
  await universitiesRepoUpsert();
  return withTenant('aaa', async (tx) => {
    const [dept] = await tx
      .insert(departments)
      .values({ tenantId: 'aaa', code: 'CS', name: 'Computer Science' })
      .returning();
    const [prog] = await tx
      .insert(programs)
      .values({
        tenantId: 'aaa',
        code: 'BSCS',
        name: 'BS Computer Science',
        departmentId: dept!.id,
        status: 'pending',
      })
      .returning();
    const [term] = await tx
      .insert(academicTerms)
      .values({
        tenantId: 'aaa',
        code: 'F25',
        name: 'Fall 2025',
        startsOn: '2025-09-01',
        endsOn: '2025-12-20',
        status: 'active',
      })
      .returning();
    // A second term with no sections: it must be excluded from the cascade's
    // step 1 (listTermsWithSections) but still appear in the raw listTerms.
    const [emptyTerm] = await tx
      .insert(academicTerms)
      .values({
        tenantId: 'aaa',
        code: 'S26',
        name: 'Spring 2026',
        startsOn: '2026-02-01',
        endsOn: '2026-05-30',
        status: 'active',
      })
      .returning();
    // A second program in the SAME term, to prove step 2/3 of the cascade
    // filter by program. Its code sorts after BSCS so existing ordering holds.
    const [prog2] = await tx
      .insert(programs)
      .values({
        tenantId: 'aaa',
        code: 'BSSE',
        name: 'BS Software Engineering',
        departmentId: dept!.id,
        status: 'active',
      })
      .returning();
    const [sec] = await tx
      .insert(sections)
      .values({
        tenantId: 'aaa',
        programId: prog!.id,
        termId: term!.id,
        name: 'A',
        semester: 5,
        status: 'active',
      })
      .returning();
    const [secB] = await tx
      .insert(sections)
      .values({
        tenantId: 'aaa',
        programId: prog2!.id,
        termId: term!.id,
        name: 'B',
        semester: 3,
        status: 'active',
      })
      .returning();
    const [course] = await tx
      .insert(courses)
      .values({ tenantId: 'aaa', code: 'CS201', title: 'Data Structures' })
      .returning();
    const [teacher] = await tx
      .insert(teachers)
      .values({ tenantId: 'aaa', name: 'Dr Ayesha', status: 'pending' })
      .returning();
    const [campus] = await tx
      .insert(campuses)
      .values({ tenantId: 'aaa', name: 'Main' })
      .returning();
    const [building] = await tx
      .insert(buildings)
      .values({ tenantId: 'aaa', campusId: campus!.id, name: 'A Block' })
      .returning();
    const [room] = await tx
      .insert(rooms)
      .values({ tenantId: 'aaa', buildingId: building!.id, name: 'R-101' })
      .returning();
    await tx.insert(timetableEntries).values([
      {
        tenantId: 'aaa',
        termId: term!.id,
        sectionId: sec!.id,
        courseId: course!.id,
        teacherId: teacher!.id,
        roomId: room!.id,
        dayOfWeek: 1,
        startsAt: '09:00',
        endsAt: '10:30',
        kind: 'lecture',
        contentHash: 'h1',
      },
      {
        tenantId: 'aaa',
        termId: term!.id,
        sectionId: sec!.id,
        courseId: course!.id,
        teacherId: null,
        roomId: null,
        dayOfWeek: 3,
        startsAt: '11:00',
        endsAt: '12:30',
        kind: 'lab',
        contentHash: 'h2',
      },
    ]);
    await tx
      .insert(ingestionRuns)
      .values({ tenantId: 'aaa', source: 'test', status: 'success', finishedAt: new Date() });
    return {
      sectionId: sec!.id,
      sectionBId: secB!.id,
      termId: term!.id,
      emptyTermId: emptyTerm!.id,
      bscsProgramId: prog!.id,
      sseProgramId: prog2!.id,
      teacherId: teacher!.id,
      roomId: room!.id,
    };
  });
}

async function universitiesRepoUpsert() {
  await getDb()
    .insert(universities)
    .values({ slug: 'aaa', name: 'Alpha U', timezone: 'Asia/Karachi' })
    .onConflictDoNothing();
}

let ids: {
  sectionId: string;
  sectionBId: string;
  termId: string;
  emptyTermId: string;
  bscsProgramId: string;
  sseProgramId: string;
  teacherId: string;
  roomId: string;
};

beforeEach(async () => {
  ids = await seed();
});

describe('TimetableQueries (enriched reads)', () => {
  it('returns enriched section views, sorted, with TBA and pending honesty', async () => {
    const views = await createTimetableQueries('aaa').sectionTimetable(ids.sectionId);
    expect(views).toHaveLength(2);

    const lecture = views[0]!;
    expect(lecture.course.title).toBe('Data Structures');
    expect(lecture.teacher?.name).toBe('Dr Ayesha');
    expect(lecture.room?.name).toBe('R-101');
    expect(lecture.pending).toBe(true); // teacher is pending

    const lab = views.find((v) => v.kind === 'lab')!;
    expect(lab.teacher).toBeNull(); // → "TBA" in the UI
    expect(lab.room).toBeNull();
  });

  it('lists terms and sections, and reports freshness', async () => {
    const q = createTimetableQueries('aaa');
    expect((await q.listTerms()).map((t) => t.code)).toContain('F25');
    expect((await q.listSectionsByTerm(ids.termId))[0]?.program.code).toBe('BSCS');
    expect((await q.freshness()).lastSuccessfulAt).not.toBeNull();
  });

  it('reads by teacher and by room', async () => {
    const q = createTimetableQueries('aaa');
    expect(await q.teacherTimetable(ids.teacherId)).toHaveLength(1);
    expect(await q.roomTimetable(ids.roomId)).toHaveLength(1);
  });
});

describe('TimetableQueries (cascade picker: term to program to section)', () => {
  it('step 1: lists only terms that have sections', async () => {
    const q = createTimetableQueries('aaa');
    const all = (await q.listTerms()).map((t) => t.code);
    expect(all).toEqual(expect.arrayContaining(['F25', 'S26']));

    const withSections = (await q.listTermsWithSections()).map((t) => t.code);
    expect(withSections).toContain('F25');
    expect(withSections).not.toContain('S26'); // the empty term is dropped
  });

  it('step 2: lists the distinct programs (including pending) that have sections in a term', async () => {
    const q = createTimetableQueries('aaa');
    const programs = await q.listProgramsByTerm(ids.termId);
    expect(programs.map((p) => p.code)).toEqual(['BSCS', 'BSSE']); // ordered by code
    // BSCS is a pending program yet must still surface (honesty over hiding).

    expect(await q.listProgramsByTerm(ids.emptyTermId)).toHaveLength(0);
  });

  it('step 3: lists only the sections of one program within one term', async () => {
    const q = createTimetableQueries('aaa');
    const bscs = await q.listSectionsByProgramTerm(ids.termId, ids.bscsProgramId);
    expect(bscs.map((s) => s.name)).toEqual(['A']);
    expect(bscs[0]?.program.code).toBe('BSCS');

    const sse = await q.listSectionsByProgramTerm(ids.termId, ids.sseProgramId);
    expect(sse.map((s) => s.name)).toEqual(['B']);
  });

  it('sitemap: lists distinct teacher and room ids that appear on current entries', async () => {
    const q = createTimetableQueries('aaa');
    expect(await q.listTeacherIdsWithEntries()).toEqual([{ id: ids.teacherId }]);
    expect(await q.listRoomIdsWithEntries()).toEqual([{ id: ids.roomId }]);
  });
});

describe('TimetableQueries.freeRooms', () => {
  it('excludes a room busy in the window and includes it (with building) when free', async () => {
    const q = createTimetableQueries('aaa');
    // R-101 has a Monday (dayOfWeek 1) 09:00 to 10:30 class in the seed.
    const busy = await q.freeRooms({
      termId: ids.termId,
      dayOfWeek: 1,
      startsAt: '09:00',
      endsAt: '10:00',
    });
    expect(busy.map((r) => r.id)).not.toContain(ids.roomId);

    const free = await q.freeRooms({
      termId: ids.termId,
      dayOfWeek: 1,
      startsAt: '14:00',
      endsAt: '15:00',
    });
    const r101 = free.find((r) => r.id === ids.roomId);
    expect(r101).toEqual({ id: ids.roomId, name: 'R-101', building: 'A Block' });
  });
});
