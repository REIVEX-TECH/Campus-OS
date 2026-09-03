import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
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

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder);
});

afterAll(async () => {
  await getSqlClient().end();
});

async function seed() {
  await runAsMigrationRole(`truncate table "universities" restart identity cascade`);
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

  it('step 1: sorts ordinal-named terms numerically (1st, 2nd, ... 10th)', async () => {
    // Insert ordinal-named terms, each with a section, out of natural order.
    await withTenant('aaa', async (tx) => {
      for (const name of ['10th Semester', '2nd Semester', '1st Semester']) {
        const [tm] = await tx
          .insert(academicTerms)
          .values({ tenantId: 'aaa', code: name, name, status: 'active' })
          .returning();
        await tx.insert(sections).values({
          tenantId: 'aaa',
          programId: ids.bscsProgramId,
          termId: tm!.id,
          name: 'X',
          semester: 1,
          status: 'active',
        });
      }
    });
    const names = (await createTimetableQueries('aaa').listTermsWithSections()).map((t) => t.name);
    const ordinals = names.filter((n) => n.endsWith('Semester'));
    expect(ordinals).toEqual(['1st Semester', '2nd Semester', '10th Semester']);
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

  it('sitemap: lists distinct course ids that appear on current entries', async () => {
    const q = createTimetableQueries('aaa');
    const course = (await q.searchCourses('data'))[0]!;
    // Both seed entries share CS201, so it appears once.
    expect(await q.listCourseIdsWithEntries()).toEqual([{ id: course.id }]);
  });
});

describe('TimetableQueries search', () => {
  it('finds teachers by name and courses by title or code (current entries only)', async () => {
    const q = createTimetableQueries('aaa');
    expect((await q.searchTeachers('ayesha')).map((t) => t.name)).toContain('Dr Ayesha');
    expect(await q.searchTeachers('zzz-nobody')).toEqual([]);
    expect((await q.searchCourses('data')).map((c) => c.code)).toContain('CS201');
    expect((await q.searchCourses('cs201')).map((c) => c.title)).toContain('Data Structures');
  });

  it('courseTimetable returns the course sessions with section, teacher, room', async () => {
    const q = createTimetableQueries('aaa');
    const course = (await q.searchCourses('data'))[0]!;
    expect((await q.getCourse(course.id))?.code).toBe('CS201');
    const views = await q.courseTimetable(course.id);
    expect(views.length).toBeGreaterThan(0);
    expect(views[0]!.section.name).toBe('A');
  });
});

describe('TimetableQueries.analytics', () => {
  it('counts existing data: totals, entries by kind and day, coverage, and pending', async () => {
    const a = await createTimetableQueries('aaa').analytics();

    expect(a.totals).toEqual({
      terms: 2, // F25 + S26
      programs: 2, // BSCS (pending) + BSSE
      sections: 2, // A + B
      courses: 1, // CS201
      teachers: 1, // Dr Ayesha
      rooms: 1, // R-101
      entries: 2, // both seed entries are live (valid_to null)
    });

    const kinds = Object.fromEntries(a.entriesByKind.map((k) => [k.kind, k.count]));
    expect(kinds).toEqual({ lecture: 1, lab: 1, tutorial: 0, exam: 0 });
    // Every kind is present, sorted by count descending.
    expect(a.entriesByKind).toHaveLength(4);
    expect(a.entriesByKind[0]!.count).toBeGreaterThanOrEqual(a.entriesByKind[3]!.count);

    // Monday (1) and Wednesday (3) each have one class; the week is fully listed.
    expect(a.entriesByDay).toHaveLength(7);
    const byDay = Object.fromEntries(a.entriesByDay.map((d) => [d.dayOfWeek, d.count]));
    expect(byDay[1]).toBe(1);
    expect(byDay[3]).toBe(1);
    expect(byDay[2]).toBe(0);

    // The lab entry has no teacher and no room, so coverage is 1 of 2.
    expect(a.coverage).toEqual({ entries: 2, withTeacher: 1, withRoom: 1 });

    // Dr Ayesha is pending; both sections are active.
    expect(a.pending).toEqual({ teachers: 1, sections: 0 });
  });
});

describe('TimetableQueries.freeRooms', () => {
  it('excludes a room busy in the window and includes it (with building) when free', async () => {
    const q = createTimetableQueries('aaa');
    // R-101 has a Monday (dayOfWeek 1) 09:00 to 10:30 class in the seed.
    const busy = await q.freeRooms({ dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00' });
    expect(busy.map((r) => r.id)).not.toContain(ids.roomId);

    const free = await q.freeRooms({ dayOfWeek: 1, startsAt: '14:00', endsAt: '15:00' });
    const r101 = free.find((r) => r.id === ids.roomId);
    expect(r101).toEqual({ id: ids.roomId, name: 'R-101', building: 'A Block' });
  });

  it('counts a class from any term, exactly as the room page does', async () => {
    // The production bug: free-rooms filtered occupancy by one term while the
    // room page showed classes from another, so a room with a class in it was
    // listed as free for that slot. A current class in a different term must
    // make the room busy.
    const q = createTimetableQueries('aaa');
    const [course] = await withTenant('aaa', (tx) => tx.select().from(courses).limit(1));
    await withTenant('aaa', (tx) =>
      tx.insert(timetableEntries).values({
        tenantId: 'aaa',
        termId: ids.emptyTermId,
        sectionId: ids.sectionId,
        courseId: course!.id,
        teacherId: null,
        roomId: ids.roomId,
        dayOfWeek: 2,
        startsAt: '09:30',
        endsAt: '11:00',
        kind: 'lecture',
        contentHash: 'other-term',
      }),
    );
    for (const [startsAt, endsAt] of [
      ['09:30', '11:00'],
      ['10:00', '10:30'],
      ['09:00', '10:00'],
      ['10:30', '12:00'],
    ]) {
      const free = await q.freeRooms({ dayOfWeek: 2, startsAt: startsAt!, endsAt: endsAt! });
      expect(
        free.map((r) => r.id),
        `${startsAt} to ${endsAt}`,
      ).not.toContain(ids.roomId);
    }
    for (const [startsAt, endsAt] of [
      ['08:00', '09:30'],
      ['11:00', '12:30'],
    ]) {
      const free = await q.freeRooms({ dayOfWeek: 2, startsAt: startsAt!, endsAt: endsAt! });
      expect(
        free.map((r) => r.id),
        `${startsAt} to ${endsAt}`,
      ).toContain(ids.roomId);
    }
    // And the room's own schedule agrees: the same class is on it.
    const schedule = await q.roomTimetable(ids.roomId);
    expect(schedule.some((v) => v.dayOfWeek === 2 && v.startsAt.startsWith('09:30'))).toBe(true);
  });

  it('does not let a closed version keep a room busy', async () => {
    const q = createTimetableQueries('aaa');
    const [course] = await withTenant('aaa', (tx) => tx.select().from(courses).limit(1));
    await withTenant('aaa', (tx) =>
      tx.insert(timetableEntries).values({
        tenantId: 'aaa',
        termId: ids.termId,
        sectionId: ids.sectionId,
        courseId: course!.id,
        teacherId: null,
        roomId: ids.roomId,
        dayOfWeek: 4,
        startsAt: '09:00',
        endsAt: '10:00',
        kind: 'lecture',
        contentHash: 'closed',
        validTo: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const free = await q.freeRooms({ dayOfWeek: 4, startsAt: '09:00', endsAt: '10:00' });
    expect(free.map((r) => r.id)).toContain(ids.roomId);
  });
});

describe('TimetableQueries directory reads', () => {
  it('reports the tenant teaching window over current entries', async () => {
    const w = await createTimetableQueries('aaa').teachingWindow();
    // Seed: Mon 09:00-10:30 and Wed 11:00-12:30.
    expect(w.startsAt).toBe('09:00');
    expect(w.endsAt).toBe('12:30');
    expect(w.days).toEqual([1, 3]);
  });

  it('lists teachers that have entries, with counts', async () => {
    const rows = await createTimetableQueries('aaa').listTeachersWithCounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Dr Ayesha',
      status: 'pending',
      classes: 1,
      courses: 1,
      days: 1,
    });
  });

  it('lists rooms that have entries, with their building and counts', async () => {
    const rows = await createTimetableQueries('aaa').listRoomsWithCounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'R-101',
      building: 'A Block',
      classes: 1,
      days: 1,
    });
  });

  it('is tenant scoped: another tenant sees none of it', async () => {
    const rows = await createTimetableQueries('zzz').listTeachersWithCounts();
    expect(rows).toEqual([]);
    const w = await createTimetableQueries('zzz').teachingWindow();
    expect(w.startsAt).toBeNull();
    expect(w.days).toEqual([]);
  });
});
