import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TenantScopedRepository } from '@campusos/db';
import { rooms } from '@campusos/db/schema';
import {
  detectConflicts,
  freeRooms,
  planTimetableDiff,
  type Conflict,
  type TimeWindow,
  type TimetableEntryInput,
} from '../domain/index';
import { timetableEntries, type TimetableEntry } from '../schema/entries';

export interface ApplyDiffStats {
  inserted: number;
  closed: number;
  unchanged: number;
}

/** Reads and versioned writes of timetable entries, scoped to one tenant. */
export class TimetableRepository extends TenantScopedRepository {
  bySection(sectionId: string): Promise<TimetableEntry[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(timetableEntries)
        .where(and(eq(timetableEntries.sectionId, sectionId), isNull(timetableEntries.validTo))),
    );
  }

  byTeacher(teacherId: string): Promise<TimetableEntry[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(timetableEntries)
        .where(and(eq(timetableEntries.teacherId, teacherId), isNull(timetableEntries.validTo))),
    );
  }

  byRoom(roomId: string): Promise<TimetableEntry[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(timetableEntries)
        .where(and(eq(timetableEntries.roomId, roomId), isNull(timetableEntries.validTo))),
    );
  }

  currentByTerm(termId: string): Promise<TimetableEntry[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(timetableEntries)
        .where(and(eq(timetableEntries.termId, termId), isNull(timetableEntries.validTo))),
    );
  }

  /** Teacher/room double-bookings among current entries in a term. */
  async findConflicts(termId: string): Promise<Conflict[]> {
    const entries = await this.currentByTerm(termId);
    return detectConflicts(
      entries.map((e) => ({
        id: e.id,
        teacherId: e.teacherId,
        roomId: e.roomId,
        dayOfWeek: e.dayOfWeek,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
      })),
    );
  }

  /** Rooms with no current entry overlapping the given day and time window. */
  findFreeRooms(query: { termId: string } & TimeWindow): Promise<string[]> {
    return this.run(async (tx) => {
      const roomRows = await tx.select({ id: rooms.id }).from(rooms);
      const occupied = await tx
        .select({
          roomId: timetableEntries.roomId,
          dayOfWeek: timetableEntries.dayOfWeek,
          startsAt: timetableEntries.startsAt,
          endsAt: timetableEntries.endsAt,
        })
        .from(timetableEntries)
        .where(
          and(
            eq(timetableEntries.termId, query.termId),
            eq(timetableEntries.dayOfWeek, query.dayOfWeek),
            isNull(timetableEntries.validTo),
          ),
        );
      const slots = occupied
        .filter((o): o is typeof o & { roomId: string } => o.roomId !== null)
        .map((o) => ({
          roomId: o.roomId,
          dayOfWeek: o.dayOfWeek,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
        }));
      return freeRooms(
        roomRows.map((r) => r.id),
        slots,
        query,
      );
    });
  }

  /**
   * Apply a normalized snapshot to a term: close entries that disappeared, insert
   * new ones, leave unchanged ones alone — all in one transaction. Idempotent.
   */
  applyDiff(scope: { termId: string }, incoming: TimetableEntryInput[]): Promise<ApplyDiffStats> {
    return this.run(async (tx) => {
      const current = await tx
        .select({ id: timetableEntries.id, contentHash: timetableEntries.contentHash })
        .from(timetableEntries)
        .where(and(eq(timetableEntries.termId, scope.termId), isNull(timetableEntries.validTo)));

      const plan = planTimetableDiff(current, incoming);

      if (plan.toCloseIds.length > 0) {
        await tx
          .update(timetableEntries)
          .set({ validTo: new Date() })
          .where(inArray(timetableEntries.id, plan.toCloseIds));
      }
      if (plan.toInsert.length > 0) {
        await tx.insert(timetableEntries).values(
          plan.toInsert.map((e) => ({
            tenantId: this.tenantId,
            termId: e.termId,
            sectionId: e.sectionId,
            courseId: e.courseId,
            teacherId: e.teacherId,
            roomId: e.roomId,
            dayOfWeek: e.dayOfWeek,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            kind: e.kind,
            sourceRef: e.sourceRef ?? null,
            contentHash: e.contentHash,
          })),
        );
      }

      return {
        inserted: plan.toInsert.length,
        closed: plan.toCloseIds.length,
        unchanged: plan.unchanged,
      };
    });
  }
}
