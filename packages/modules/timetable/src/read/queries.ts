import { and, count, desc, eq, exists, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { TenantScopedRepository, type TenantTransaction } from '@campusos/db';
import { buildings, rooms } from '@campusos/db/schema';
import { freeRooms as computeFreeRooms, type OccupiedSlot, type TimeWindow } from '../domain/index';
import { academicTerms, courses, programs, sections, teachers } from '../schema/catalog';
import { timetableEntries } from '../schema/entries';
import { timetableEntryKind, type TimetableEntryKind } from '../schema/enums';
import { ingestionRuns } from '../schema/ingestion';
import type {
  Freshness,
  RoomDirectoryEntry,
  TeacherDirectoryEntry,
  TeachingWindow,
  ProgramSummary,
  RecordStatus,
  RoomSummary,
  SectionSummary,
  TeacherSummary,
  TermSummary,
  TimetableAnalytics,
  TimetableView,
} from './types';

const VIEW_COLUMNS = {
  entryId: timetableEntries.id,
  dayOfWeek: timetableEntries.dayOfWeek,
  startsAt: timetableEntries.startsAt,
  endsAt: timetableEntries.endsAt,
  kind: timetableEntries.kind,
  validFrom: timetableEntries.validFrom,
  courseId: courses.id,
  courseCode: courses.code,
  courseTitle: courses.title,
  teacherId: teachers.id,
  teacherName: teachers.name,
  teacherStatus: teachers.status,
  roomId: rooms.id,
  roomName: rooms.name,
  sectionId: sections.id,
  sectionName: sections.name,
  sectionStatus: sections.status,
};

interface RawViewRow {
  entryId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  kind: TimetableEntryKind;
  validFrom: Date;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  teacherId: string | null;
  teacherName: string | null;
  teacherStatus: RecordStatus | null;
  roomId: string | null;
  roomName: string | null;
  sectionId: string;
  sectionName: string;
  sectionStatus: RecordStatus;
}

function toView(row: RawViewRow): TimetableView {
  const teacher = row.teacherId
    ? { id: row.teacherId, name: row.teacherName ?? '', status: row.teacherStatus ?? 'active' }
    : null;
  return {
    entryId: row.entryId,
    dayOfWeek: row.dayOfWeek,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    kind: row.kind,
    course: { id: row.courseId, code: row.courseCode, title: row.courseTitle },
    teacher,
    room: row.roomId ? { id: row.roomId, name: row.roomName ?? '' } : null,
    section: { id: row.sectionId, name: row.sectionName, status: row.sectionStatus },
    validFrom: row.validFrom.toISOString(),
    pending: row.sectionStatus === 'pending' || teacher?.status === 'pending',
  };
}

function sortViews(views: TimetableView[]): TimetableView[] {
  return [...views].sort((a, b) =>
    a.dayOfWeek !== b.dayOfWeek ? a.dayOfWeek - b.dayOfWeek : a.startsAt.localeCompare(b.startsAt),
  );
}

/** Read-only, tenant-scoped timetable queries for the UI and ICS feeds. */
export class TimetableQueries extends TenantScopedRepository {
  private viewsWhere(tx: TenantTransaction, where: SQL | undefined) {
    return tx
      .select(VIEW_COLUMNS)
      .from(timetableEntries)
      .innerJoin(courses, eq(courses.id, timetableEntries.courseId))
      .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
      .leftJoin(teachers, eq(teachers.id, timetableEntries.teacherId))
      .leftJoin(rooms, eq(rooms.id, timetableEntries.roomId))
      .where(where);
  }

  private async viewsBy(column: SQL | undefined): Promise<TimetableView[]> {
    const rows = (await this.run((tx) => this.viewsWhere(tx, column))) as RawViewRow[];
    return sortViews(rows.map(toView));
  }

  sectionTimetable(sectionId: string): Promise<TimetableView[]> {
    return this.viewsBy(
      and(eq(timetableEntries.sectionId, sectionId), isNull(timetableEntries.validTo)),
    );
  }

  teacherTimetable(teacherId: string): Promise<TimetableView[]> {
    return this.viewsBy(
      and(eq(timetableEntries.teacherId, teacherId), isNull(timetableEntries.validTo)),
    );
  }

  roomTimetable(roomId: string): Promise<TimetableView[]> {
    return this.viewsBy(and(eq(timetableEntries.roomId, roomId), isNull(timetableEntries.validTo)));
  }

  listTerms(): Promise<TermSummary[]> {
    return this.run((tx) =>
      tx
        .select({
          id: academicTerms.id,
          code: academicTerms.code,
          name: academicTerms.name,
          status: academicTerms.status,
          startsOn: academicTerms.startsOn,
          endsOn: academicTerms.endsOn,
        })
        .from(academicTerms)
        .where(isNull(academicTerms.deletedAt))
        .orderBy(desc(academicTerms.createdAt)),
    );
  }

  async getTerm(termId: string): Promise<TermSummary | null> {
    const terms = await this.listTerms();
    return terms.find((t) => t.id === termId) ?? null;
  }

  listSectionsByTerm(termId: string): Promise<SectionSummary[]> {
    return this.run((tx) =>
      tx
        .select({
          id: sections.id,
          name: sections.name,
          status: sections.status,
          semester: sections.semester,
          termId: sections.termId,
          program: { id: programs.id, code: programs.code, name: programs.name },
        })
        .from(sections)
        .innerJoin(programs, eq(programs.id, sections.programId))
        .where(and(eq(sections.termId, termId), isNull(sections.deletedAt)))
        .orderBy(programs.code, sections.name),
    );
  }

  /**
   * Step 1 of the cascade: terms that actually have at least one section, sorted
   * so an ordinal-prefixed name reads 1st, 2nd, ... 10th. Insertion order (the
   * crawl order) leaves them jumbled, so we sort numeric-aware by name.
   */
  async listTermsWithSections(): Promise<TermSummary[]> {
    const rows = await this.run((tx) =>
      tx
        .select({
          id: academicTerms.id,
          code: academicTerms.code,
          name: academicTerms.name,
          status: academicTerms.status,
          startsOn: academicTerms.startsOn,
          endsOn: academicTerms.endsOn,
        })
        .from(academicTerms)
        .where(
          and(
            isNull(academicTerms.deletedAt),
            exists(
              tx
                .select({ one: sql`1` })
                .from(sections)
                .where(and(eq(sections.termId, academicTerms.id), isNull(sections.deletedAt))),
            ),
          ),
        ),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  }

  /** Step 2: the distinct programs that have sections in a given term. */
  listProgramsByTerm(termId: string): Promise<ProgramSummary[]> {
    return this.run((tx) =>
      tx
        .selectDistinct({ id: programs.id, code: programs.code, name: programs.name })
        .from(sections)
        .innerJoin(programs, eq(programs.id, sections.programId))
        .where(
          and(eq(sections.termId, termId), isNull(sections.deletedAt), isNull(programs.deletedAt)),
        )
        .orderBy(programs.code),
    );
  }

  /** Step 3: the sections of one program within one term. */
  listSectionsByProgramTerm(termId: string, programId: string): Promise<SectionSummary[]> {
    return this.run((tx) =>
      tx
        .select({
          id: sections.id,
          name: sections.name,
          status: sections.status,
          semester: sections.semester,
          termId: sections.termId,
          program: { id: programs.id, code: programs.code, name: programs.name },
        })
        .from(sections)
        .innerJoin(programs, eq(programs.id, sections.programId))
        .where(
          and(
            eq(sections.termId, termId),
            eq(sections.programId, programId),
            isNull(sections.deletedAt),
          ),
        )
        .orderBy(sections.semester, sections.name),
    );
  }

  /** Distinct teacher ids that appear on a current entry (for the sitemap). */
  listTeacherIdsWithEntries(): Promise<{ id: string }[]> {
    return this.run(async (tx) => {
      const rows = await tx
        .selectDistinct({ id: timetableEntries.teacherId })
        .from(timetableEntries)
        .where(
          and(isNull(timetableEntries.validTo), sql`${timetableEntries.teacherId} is not null`),
        );
      return rows.filter((r): r is { id: string } => r.id !== null);
    });
  }

  /** Distinct course ids that appear on a current entry (for the sitemap). */
  listCourseIdsWithEntries(): Promise<{ id: string }[]> {
    return this.run((tx) =>
      tx
        .selectDistinct({ id: timetableEntries.courseId })
        .from(timetableEntries)
        .where(isNull(timetableEntries.validTo)),
    );
  }

  /** Distinct room ids that appear on a current entry (for the sitemap). */
  listRoomIdsWithEntries(): Promise<{ id: string }[]> {
    return this.run(async (tx) => {
      const rows = await tx
        .selectDistinct({ id: timetableEntries.roomId })
        .from(timetableEntries)
        .where(and(isNull(timetableEntries.validTo), sql`${timetableEntries.roomId} is not null`));
      return rows.filter((r): r is { id: string } => r.id !== null);
    });
  }

  async getSection(sectionId: string): Promise<SectionSummary | null> {
    const rows = await this.run((tx) =>
      tx
        .select({
          id: sections.id,
          name: sections.name,
          status: sections.status,
          semester: sections.semester,
          termId: sections.termId,
          program: { id: programs.id, code: programs.code, name: programs.name },
        })
        .from(sections)
        .innerJoin(programs, eq(programs.id, sections.programId))
        .where(eq(sections.id, sectionId))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  /** Teachers with a current entry whose name matches the query (for search). */
  searchTeachers(query: string, limit = 20): Promise<{ id: string; name: string }[]> {
    const q = `%${query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.run((tx) =>
      tx
        .selectDistinct({ id: teachers.id, name: teachers.name })
        .from(teachers)
        .innerJoin(timetableEntries, eq(timetableEntries.teacherId, teachers.id))
        .where(and(isNull(timetableEntries.validTo), ilike(teachers.name, q)))
        .orderBy(teachers.name)
        .limit(limit),
    );
  }

  /** Courses with a current entry whose code or title matches the query. */
  searchCourses(query: string, limit = 20): Promise<{ id: string; code: string; title: string }[]> {
    const q = `%${query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.run((tx) =>
      tx
        .selectDistinct({ id: courses.id, code: courses.code, title: courses.title })
        .from(courses)
        .innerJoin(timetableEntries, eq(timetableEntries.courseId, courses.id))
        .where(
          and(
            isNull(timetableEntries.validTo),
            or(ilike(courses.title, q), ilike(courses.code, q)),
          ),
        )
        .orderBy(courses.title)
        .limit(limit),
    );
  }

  async getCourse(courseId: string): Promise<{ id: string; code: string; title: string } | null> {
    const rows = await this.run((tx) =>
      tx
        .select({ id: courses.id, code: courses.code, title: courses.title })
        .from(courses)
        .where(eq(courses.id, courseId))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  /** Every current session of a course (across sections): where, when, who. */
  courseTimetable(courseId: string): Promise<TimetableView[]> {
    return this.viewsBy(
      and(eq(timetableEntries.courseId, courseId), isNull(timetableEntries.validTo)),
    );
  }

  async getTeacher(teacherId: string): Promise<TeacherSummary | null> {
    const rows = await this.run((tx) =>
      tx
        .select({ id: teachers.id, name: teachers.name, status: teachers.status })
        .from(teachers)
        .where(eq(teachers.id, teacherId))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  /**
   * Every current class in a room on one weekday, across every term.
   *
   * THE definition of "this room is busy" for the read model. The room page
   * shows a room's schedule as its current entries with no term filter; anything
   * that decides whether a room is free must look at exactly the same rows, or
   * the two disagree. They did: free-rooms filtered by one term while the room
   * page showed classes from another, and a room with a class in it was listed
   * as free for that very slot. A closed version (`valid_to` set) is history,
   * and an entry with no resolved room occupies nothing.
   */
  occupancy(dayOfWeek: number): Promise<OccupiedSlot[]> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({
          roomId: timetableEntries.roomId,
          dayOfWeek: timetableEntries.dayOfWeek,
          startsAt: timetableEntries.startsAt,
          endsAt: timetableEntries.endsAt,
        })
        .from(timetableEntries)
        .where(and(eq(timetableEntries.dayOfWeek, dayOfWeek), isNull(timetableEntries.validTo)));
      return rows
        .filter((o): o is typeof o & { roomId: string } => o.roomId !== null)
        .map((o) => ({
          roomId: o.roomId,
          dayOfWeek: o.dayOfWeek,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
        }));
    });
  }

  /**
   * Public "free rooms": live rooms with no current class overlapping the
   * window, on that weekday, in any term. Returns room name and building,
   * sorted by name. Built on `occupancy`, so it cannot disagree with a room's
   * own page about whether the room is in use.
   */
  async freeRooms(window: TimeWindow): Promise<{ id: string; name: string; building: string }[]> {
    const [roomRows, slots] = await Promise.all([
      this.run((tx) =>
        tx
          .select({ id: rooms.id, name: rooms.name, building: buildings.name })
          .from(rooms)
          .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
          .where(isNull(rooms.deletedAt))
          .orderBy(rooms.name),
      ),
      this.occupancy(window.dayOfWeek),
    ]);
    const free = new Set(
      computeFreeRooms(
        roomRows.map((r) => r.id),
        slots,
        window,
      ),
    );
    return roomRows.filter((r) => free.has(r.id));
  }

  async getRoom(roomId: string): Promise<RoomSummary | null> {
    const rows = await this.run((tx) =>
      tx
        .select({ id: rooms.id, name: rooms.name })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  /**
   * Read-only aggregate counts over the tenant's existing data (admin analytics).
   * Collects nothing new: every figure is a count of rows already stored.
   * Queries run sequentially on the one tenant-scoped connection.
   */
  /**
   * The tenant's observed teaching window over current entries: earliest start,
   * latest end, and the weekdays that carry classes. Free-slot and utilisation
   * maths measure against this one window so figures compare across entities.
   */
  async teachingWindow(): Promise<TeachingWindow> {
    return this.run(async (tx) => {
      const [span] = await tx
        .select({
          startsAt: sql<string | null>`min(${timetableEntries.startsAt})`,
          endsAt: sql<string | null>`max(${timetableEntries.endsAt})`,
        })
        .from(timetableEntries)
        .where(isNull(timetableEntries.validTo));
      const dayRows = await tx
        .selectDistinct({ day: timetableEntries.dayOfWeek })
        .from(timetableEntries)
        .where(isNull(timetableEntries.validTo));
      // Postgres returns `time` as HH:MM:SS; the enriched views expose HH:MM, so
      // trim to keep one shape across the read layer.
      const hhmm = (v: string | null): string | null => (v ? v.slice(0, 5) : null);
      return {
        startsAt: hhmm(span?.startsAt ?? null),
        endsAt: hhmm(span?.endsAt ?? null),
        days: dayRows.map((r) => r.day).sort((a, b) => a - b),
      };
    });
  }

  /** Every teacher who has current entries, with counts, for the directory. */
  listTeachersWithCounts(): Promise<TeacherDirectoryEntry[]> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({
          id: teachers.id,
          name: teachers.name,
          status: teachers.status,
          classes: sql<number>`count(${timetableEntries.id})::int`,
          courses: sql<number>`count(distinct ${timetableEntries.courseId})::int`,
          days: sql<number>`count(distinct ${timetableEntries.dayOfWeek})::int`,
        })
        .from(teachers)
        .innerJoin(
          timetableEntries,
          and(eq(timetableEntries.teacherId, teachers.id), isNull(timetableEntries.validTo)),
        )
        .groupBy(teachers.id, teachers.name, teachers.status);
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    });
  }

  /** Every room that has current entries, with counts, for the directory. */
  listRoomsWithCounts(): Promise<RoomDirectoryEntry[]> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({
          id: rooms.id,
          name: rooms.name,
          building: buildings.name,
          classes: sql<number>`count(${timetableEntries.id})::int`,
          days: sql<number>`count(distinct ${timetableEntries.dayOfWeek})::int`,
        })
        .from(rooms)
        .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
        .innerJoin(
          timetableEntries,
          and(eq(timetableEntries.roomId, rooms.id), isNull(timetableEntries.validTo)),
        )
        .groupBy(rooms.id, rooms.name, buildings.name);
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    });
  }

  async analytics(): Promise<TimetableAnalytics> {
    return this.run(async (tx) => {
      const live = isNull(timetableEntries.validTo);
      const scalar = async (rows: PromiseLike<{ n: number }[]>): Promise<number> =>
        (await rows)[0]?.n ?? 0;

      const totals = {
        terms: await scalar(
          tx.select({ n: count() }).from(academicTerms).where(isNull(academicTerms.deletedAt)),
        ),
        programs: await scalar(
          tx.select({ n: count() }).from(programs).where(isNull(programs.deletedAt)),
        ),
        sections: await scalar(
          tx.select({ n: count() }).from(sections).where(isNull(sections.deletedAt)),
        ),
        courses: await scalar(
          tx.select({ n: count() }).from(courses).where(isNull(courses.deletedAt)),
        ),
        teachers: await scalar(
          tx.select({ n: count() }).from(teachers).where(isNull(teachers.deletedAt)),
        ),
        rooms: await scalar(tx.select({ n: count() }).from(rooms).where(isNull(rooms.deletedAt))),
        entries: await scalar(tx.select({ n: count() }).from(timetableEntries).where(live)),
      };

      const kindRows = (await tx
        .select({ kind: timetableEntries.kind, n: count() })
        .from(timetableEntries)
        .where(live)
        .groupBy(timetableEntries.kind)) as { kind: TimetableEntryKind; n: number }[];
      const kindMap = new Map(kindRows.map((r) => [r.kind, r.n]));
      const entriesByKind = timetableEntryKind.enumValues
        .map((kind) => ({ kind, count: kindMap.get(kind) ?? 0 }))
        .sort((a, b) => b.count - a.count);

      const dayRows = (await tx
        .select({ dayOfWeek: timetableEntries.dayOfWeek, n: count() })
        .from(timetableEntries)
        .where(live)
        .groupBy(timetableEntries.dayOfWeek)) as { dayOfWeek: number; n: number }[];
      const dayMap = new Map(dayRows.map((r) => [r.dayOfWeek, r.n]));
      const entriesByDay = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        dayOfWeek,
        count: dayMap.get(dayOfWeek) ?? 0,
      }));

      const withTeacher = await scalar(
        tx
          .select({ n: count() })
          .from(timetableEntries)
          .where(and(live, sql`${timetableEntries.teacherId} is not null`)),
      );
      const withRoom = await scalar(
        tx
          .select({ n: count() })
          .from(timetableEntries)
          .where(and(live, sql`${timetableEntries.roomId} is not null`)),
      );

      const pendingTeachers = await scalar(
        tx
          .select({ n: count() })
          .from(teachers)
          .where(and(isNull(teachers.deletedAt), eq(teachers.status, 'pending'))),
      );
      const pendingSections = await scalar(
        tx
          .select({ n: count() })
          .from(sections)
          .where(and(isNull(sections.deletedAt), eq(sections.status, 'pending'))),
      );

      return {
        totals,
        entriesByKind,
        entriesByDay,
        coverage: { entries: totals.entries, withTeacher, withRoom },
        pending: { teachers: pendingTeachers, sections: pendingSections },
      };
    });
  }

  async freshness(): Promise<Freshness> {
    const rows = await this.run((tx) =>
      tx
        .select({ finishedAt: ingestionRuns.finishedAt, source: ingestionRuns.source })
        .from(ingestionRuns)
        .where(eq(ingestionRuns.status, 'success'))
        .orderBy(desc(ingestionRuns.finishedAt))
        .limit(1),
    );
    const row = rows[0];
    return {
      lastSuccessfulAt: row?.finishedAt ? row.finishedAt.toISOString() : null,
      source: row?.source ?? null,
    };
  }
}

export function createTimetableQueries(tenantId: string): TimetableQueries {
  return new TimetableQueries(tenantId);
}
