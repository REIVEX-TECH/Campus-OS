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
    return { sectionId: sec!.id, termId: term!.id, teacherId: teacher!.id, roomId: room!.id };
  });
}

async function universitiesRepoUpsert() {
  await getDb()
    .insert(universities)
    .values({ slug: 'aaa', name: 'Alpha U', timezone: 'Asia/Karachi' })
    .onConflictDoNothing();
}

let ids: { sectionId: string; termId: string; teacherId: string; roomId: string };

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
