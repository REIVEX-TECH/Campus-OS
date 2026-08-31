import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { withTenant, type TenantTransaction } from '@campusos/db';
import { rooms } from '@campusos/db/schema';
import type {
  IngestionRunStatus,
  IngestionSink,
  IngestionStats,
  NormalizedBatch,
  RawTimetablePayload,
  UnmappedKind,
} from '@campusos/core/ingestion';
import { planTimetableDiff, type TimetableEntryInput } from '../domain/index';
import {
  academicTerms,
  courses,
  departments,
  programs,
  sections,
  teachers,
} from '../schema/catalog';
import { timetableEntries } from '../schema/entries';
import { ingestionRuns, sourceSnapshots, unmappedSourceValues } from '../schema/ingestion';

/**
 * Persists a NormalizedBatch into the timetable schema for one tenant. New
 * dimension rows are created with status 'pending' for admin review (rather than
 * failing the run or dropping data). Entries are diffed per term and applied
 * with versioning. All work for a run's persist happens in one transaction.
 */
export class TimetableSink implements IngestionSink {
  constructor(private readonly tenantId: string) {}

  startRun(source: string): Promise<string> {
    return withTenant(this.tenantId, async (tx) => {
      const rows = await tx
        .insert(ingestionRuns)
        .values({ tenantId: this.tenantId, source, status: 'running' })
        .returning({ id: ingestionRuns.id });
      const row = rows[0];
      if (!row) throw new Error('failed to create ingestion run');
      return row.id;
    });
  }

  recordSnapshot(runId: string, raw: RawTimetablePayload): Promise<void> {
    return withTenant(this.tenantId, async (tx) => {
      await tx.insert(sourceSnapshots).values({
        tenantId: this.tenantId,
        ingestionRunId: runId,
        sourceRef: raw.source,
        payload: raw as unknown as Record<string, unknown>,
        contentHash: createHash('sha256').update(JSON.stringify(raw.records)).digest('hex'),
      });
    });
  }

  finishRun(
    runId: string,
    status: IngestionRunStatus,
    stats: IngestionStats | null,
    error?: string,
  ): Promise<void> {
    return withTenant(this.tenantId, async (tx) => {
      await tx
        .update(ingestionRuns)
        .set({
          status,
          finishedAt: new Date(),
          stats: stats ?? {},
          error: error ?? null,
        })
        .where(eq(ingestionRuns.id, runId));
    });
  }

  persist(batch: NormalizedBatch, ctx: { runId: string; source: string }): Promise<IngestionStats> {
    return withTenant(this.tenantId, (tx) => this.persistInTx(tx, batch, ctx.runId));
  }

  private async persistInTx(
    tx: TenantTransaction,
    batch: NormalizedBatch,
    runId: string,
  ): Promise<IngestionStats> {
    const tid = this.tenantId;
    let unknowns = 0;

    const recordUnmapped = async (kind: UnmappedKind, rawValue: string): Promise<void> => {
      await tx
        .insert(unmappedSourceValues)
        .values({ tenantId: tid, ingestionRunId: runId, kind, rawValue })
        .onConflictDoNothing();
      unknowns += 1;
    };

    const deptIds = new Map<string, string>();
    for (const d of batch.departments) {
      const existing = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.tenantId, tid), eq(departments.code, d.code)))
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(departments)
          .values({ tenantId: tid, code: d.code, name: d.name })
          .returning({ id: departments.id });
        id = ins[0]?.id;
      }
      if (id) deptIds.set(d.code, id);
    }

    const termIds = new Map<string, string>();
    for (const t of batch.terms) {
      const existing = await tx
        .select({ id: academicTerms.id })
        .from(academicTerms)
        .where(and(eq(academicTerms.tenantId, tid), eq(academicTerms.code, t.code)))
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(academicTerms)
          .values({ tenantId: tid, code: t.code, name: t.name, status: 'pending' })
          .returning({ id: academicTerms.id });
        id = ins[0]?.id;
        await recordUnmapped('term', t.code);
      }
      if (id) termIds.set(t.code, id);
    }

    const programIds = new Map<string, string>();
    for (const p of batch.programs) {
      const departmentId = deptIds.get(p.departmentCode);
      if (!departmentId) {
        await recordUnmapped('program', p.code);
        continue;
      }
      const existing = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.tenantId, tid), eq(programs.code, p.code)))
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(programs)
          .values({ tenantId: tid, code: p.code, name: p.name, departmentId, status: 'pending' })
          .returning({ id: programs.id });
        id = ins[0]?.id;
        await recordUnmapped('program', p.code);
      }
      if (id) programIds.set(p.code, id);
    }

    const courseIds = new Map<string, string>();
    for (const c of batch.courses) {
      const departmentId = c.departmentCode ? (deptIds.get(c.departmentCode) ?? null) : null;
      const existing = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.tenantId, tid), eq(courses.code, c.code)))
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(courses)
          .values({ tenantId: tid, code: c.code, title: c.title, departmentId })
          .returning({ id: courses.id });
        id = ins[0]?.id;
      }
      if (id) courseIds.set(c.code, id);
    }

    const teacherIds = new Map<string, string>();
    for (const te of batch.teachers) {
      const existing = await tx
        .select({ id: teachers.id })
        .from(teachers)
        .where(and(eq(teachers.tenantId, tid), eq(teachers.name, te.name)))
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(teachers)
          .values({
            tenantId: tid,
            name: te.name,
            employeeCode: te.employeeCode ?? null,
            status: 'pending',
          })
          .returning({ id: teachers.id });
        id = ins[0]?.id;
        await recordUnmapped('teacher', te.name);
      }
      if (id) teacherIds.set(te.name, id);
    }

    const sectionIds = new Map<string, string>();
    for (const s of batch.sections) {
      const programId = programIds.get(s.programCode);
      const termId = termIds.get(s.termCode);
      if (!programId || !termId) {
        await recordUnmapped('section', s.code);
        continue;
      }
      const existing = await tx
        .select({ id: sections.id })
        .from(sections)
        .where(
          and(
            eq(sections.tenantId, tid),
            eq(sections.programId, programId),
            eq(sections.termId, termId),
            eq(sections.name, s.name),
          ),
        )
        .limit(1);
      let id = existing[0]?.id;
      if (!id) {
        const ins = await tx
          .insert(sections)
          .values({
            tenantId: tid,
            programId,
            termId,
            name: s.name,
            semester: s.semester ?? null,
            status: 'pending',
          })
          .returning({ id: sections.id });
        id = ins[0]?.id;
        await recordUnmapped('section', s.code);
      }
      if (id) sectionIds.set(s.code, id);
    }

    const roomRows = await tx.select({ id: rooms.id, name: rooms.name }).from(rooms);
    const roomByName = new Map(roomRows.map((r) => [r.name.toLowerCase(), r.id]));

    // Self-heal: a raw room string an admin already mapped (status 'resolved',
    // resolved_id set) resolves to that room even if its canonical name differs,
    // so a re-crawl does not re-flag it as pending or undo the admin's work.
    const resolvedRoomRows = await tx
      .select({
        rawValue: unmappedSourceValues.rawValue,
        resolvedId: unmappedSourceValues.resolvedId,
      })
      .from(unmappedSourceValues)
      .where(
        and(
          eq(unmappedSourceValues.tenantId, tid),
          eq(unmappedSourceValues.kind, 'room'),
          eq(unmappedSourceValues.status, 'resolved'),
        ),
      );
    const roomByAlias = new Map<string, string>();
    for (const r of resolvedRoomRows) {
      if (r.resolvedId) roomByAlias.set(r.rawValue.toLowerCase(), r.resolvedId);
    }

    const byTerm = new Map<string, TimetableEntryInput[]>();
    for (const e of batch.entries) {
      const termId = termIds.get(e.termCode);
      const sectionId = sectionIds.get(e.sectionCode);
      const courseId = courseIds.get(e.courseCode);
      if (!termId || !sectionId || !courseId) {
        await recordUnmapped('section', e.sectionCode);
        continue;
      }
      const teacherId = e.teacherName ? (teacherIds.get(e.teacherName) ?? null) : null;
      let roomId: string | null = null;
      if (e.roomName) {
        const key = e.roomName.toLowerCase();
        roomId = roomByName.get(key) ?? roomByAlias.get(key) ?? null;
        if (!roomId) await recordUnmapped('room', e.roomName);
      }
      const input: TimetableEntryInput = {
        termId,
        sectionId,
        courseId,
        teacherId,
        roomId,
        dayOfWeek: e.dayOfWeek,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        kind: e.kind,
        sourceRef: e.sourceRef ?? null,
        roomSource: e.roomName ?? null,
      };
      const list = byTerm.get(termId) ?? [];
      list.push(input);
      byTerm.set(termId, list);
    }

    for (const u of batch.unknowns) {
      await recordUnmapped(u.kind, u.rawValue);
    }

    let inserted = 0;
    let closed = 0;
    let unchanged = 0;
    for (const [termId, incoming] of byTerm) {
      const current = await tx
        .select({ id: timetableEntries.id, contentHash: timetableEntries.contentHash })
        .from(timetableEntries)
        .where(and(eq(timetableEntries.termId, termId), isNull(timetableEntries.validTo)));
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
            tenantId: tid,
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
            roomSource: e.roomSource ?? null,
            contentHash: e.contentHash,
          })),
        );
      }
      inserted += plan.toInsert.length;
      closed += plan.toCloseIds.length;
      unchanged += plan.unchanged;
    }

    return { inserted, closed, unchanged, unknowns };
  }
}
