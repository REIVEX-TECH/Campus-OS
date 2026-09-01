import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantScopedRepository } from '@campusos/db';
import { rooms } from '@campusos/db/schema';
import { computeContentHash, roomDedupKey, roomDisplayName } from '../domain/index';
import { ensureUnassignedBuilding } from '../ingestion/ensure-building';
import { timetableEntries } from '../schema/entries';
import { unmappedSourceValues } from '../schema/ingestion';

export interface PendingRoom {
  /** The raw source room string (e.g. "Room 25 NB"). */
  rawValue: string;
  /** Current TBA entries this value blocks (room_id null, valid_to null). */
  blockedEntries: number;
}

export interface RoomOption {
  id: string;
  name: string;
}

export type ResolveRoomInput = { rawValue: string } & (
  { existingRoomId: string } | { newRoomName: string }
);

export interface ResolveRoomResult {
  roomId: string;
  roomName: string;
  resolvedEntries: number;
}

export interface BackfillRoomsResult {
  /** Existing rooms that had `dedup_key` populated by this run. */
  keysBackfilled: number;
  /** Canonical rooms created from previously-pending room strings. */
  roomsCreated: number;
  /** TBA entries relinked to a room. */
  entriesRelinked: number;
  /** Pending room values marked resolved. */
  pendingResolved: number;
}

export class RoomResolveError extends Error {
  constructor(
    readonly code: 'room_not_found' | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'RoomResolveError';
  }
}

/**
 * Admin operations that resolve pending room strings into canonical rooms.
 * Tenant-scoped through TenantScopedRepository -> withTenant, so RLS applies to
 * every statement. Resolving is one transaction: create/attach the room,
 * back-fill the blocked entries in place (set room_id and recompute content_hash
 * for the current TBA rows), and mark the unmapped value resolved so future
 * crawls self-heal via the sink's alias map.
 *
 * Filling in a missing room is data enrichment, not a schedule change, so the
 * current row is updated in place rather than versioned. Crucially, the
 * recomputed content_hash equals what the next ingest computes for the same slot
 * (roomId now resolves by name or alias), so the map-then-reingest cycle
 * produces ZERO new versions (idempotent).
 */
export class AdminRoomsRepository extends TenantScopedRepository {
  listPendingRooms(): Promise<PendingRoom[]> {
    return this.run(async (tx) => {
      const pending = await tx
        .select({ rawValue: unmappedSourceValues.rawValue })
        .from(unmappedSourceValues)
        .where(
          and(eq(unmappedSourceValues.kind, 'room'), eq(unmappedSourceValues.status, 'pending')),
        )
        .orderBy(unmappedSourceValues.rawValue);

      const counts = await tx
        .select({
          key: sql<string>`lower(${timetableEntries.roomSource})`.as('key'),
          n: sql<number>`count(*)::int`,
        })
        .from(timetableEntries)
        .where(
          and(
            isNull(timetableEntries.validTo),
            isNull(timetableEntries.roomId),
            sql`${timetableEntries.roomSource} is not null`,
          ),
        )
        .groupBy(sql`lower(${timetableEntries.roomSource})`);

      const byKey = new Map(counts.map((c) => [c.key, Number(c.n)]));
      return pending.map((p) => ({
        rawValue: p.rawValue,
        blockedEntries: byKey.get(p.rawValue.toLowerCase()) ?? 0,
      }));
    });
  }

  listRooms(): Promise<RoomOption[]> {
    return this.run((tx) =>
      tx.select({ id: rooms.id, name: rooms.name }).from(rooms).orderBy(rooms.name),
    );
  }

  resolveRoom(input: ResolveRoomInput): Promise<ResolveRoomResult> {
    return this.run(async (tx) => {
      const rawValue = input.rawValue.trim();
      if (!rawValue) throw new RoomResolveError('invalid_input', 'rawValue is required');

      // Resolve the target room: an existing one, or a new canonical row.
      let roomId: string;
      let roomName: string;
      if ('existingRoomId' in input) {
        const found = await tx
          .select({ id: rooms.id, name: rooms.name })
          .from(rooms)
          .where(eq(rooms.id, input.existingRoomId))
          .limit(1);
        const row = found[0];
        if (!row) throw new RoomResolveError('room_not_found', 'target room not found in tenant');
        roomId = row.id;
        roomName = row.name;
      } else {
        const name = input.newRoomName.trim();
        if (!name) throw new RoomResolveError('invalid_input', 'newRoomName is required');
        const buildingId = await ensureUnassignedBuilding(tx, this.tenantId);
        const created = await tx
          .insert(rooms)
          .values({ tenantId: this.tenantId, buildingId, name, dedupKey: roomDedupKey(name) })
          .returning({ id: rooms.id, name: rooms.name });
        const row = created[0];
        if (!row) throw new RoomResolveError('invalid_input', 'room insert returned no row');
        roomId = row.id;
        roomName = row.name;
      }

      // Back-fill the current TBA entries carrying this raw string.
      const blocked = await tx
        .select({
          id: timetableEntries.id,
          termId: timetableEntries.termId,
          sectionId: timetableEntries.sectionId,
          courseId: timetableEntries.courseId,
          teacherId: timetableEntries.teacherId,
          dayOfWeek: timetableEntries.dayOfWeek,
          startsAt: timetableEntries.startsAt,
          endsAt: timetableEntries.endsAt,
          kind: timetableEntries.kind,
        })
        .from(timetableEntries)
        .where(
          and(
            isNull(timetableEntries.validTo),
            isNull(timetableEntries.roomId),
            sql`lower(${timetableEntries.roomSource}) = ${rawValue.toLowerCase()}`,
          ),
        );

      for (const e of blocked) {
        const contentHash = computeContentHash({
          termId: e.termId,
          sectionId: e.sectionId,
          courseId: e.courseId,
          teacherId: e.teacherId,
          roomId,
          dayOfWeek: e.dayOfWeek,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          kind: e.kind,
        });
        await tx
          .update(timetableEntries)
          .set({ roomId, contentHash })
          .where(eq(timetableEntries.id, e.id));
      }

      // Mark the unmapped value resolved so re-crawls self-heal (sink alias map).
      await tx
        .update(unmappedSourceValues)
        .set({ status: 'resolved', resolvedId: roomId, updatedAt: new Date() })
        .where(
          and(eq(unmappedSourceValues.kind, 'room'), eq(unmappedSourceValues.rawValue, rawValue)),
        );

      return { roomId, roomName, resolvedEntries: blocked.length };
    });
  }

  /**
   * One-shot migration of rooms already sitting pending from prior ingests (see
   * scripts/backfill-rooms.ts). Now that the sink auto-creates rooms, old crawls
   * left `unmapped_source_values` rows (kind='room', status='pending') and TBA
   * entries. This (a) populates `dedup_key` on existing rooms, then (b) for each
   * pending value, finds-or-creates the canonical room by dedup key, relinks the
   * current TBA entries carrying that raw string (recomputing content_hash in
   * place so a re-ingest is a no-op), and marks the value resolved. Touches only
   * status='pending' rows, so prior admin-resolved mappings are preserved.
   * Idempotent: a second run finds every room already keyed and every value
   * already resolved.
   */
  backfillRooms(): Promise<BackfillRoomsResult> {
    return this.run(async (tx) => {
      // (a) Backfill dedup_key on existing rooms, building a key -> id map.
      const existing = await tx
        .select({ id: rooms.id, name: rooms.name, dedupKey: rooms.dedupKey })
        .from(rooms)
        .where(isNull(rooms.deletedAt));
      const roomByKey = new Map<string, string>();
      let keysBackfilled = 0;
      for (const r of existing) {
        const key = r.dedupKey ?? roomDedupKey(r.name);
        if (r.dedupKey === null && key) {
          await tx.update(rooms).set({ dedupKey: key }).where(eq(rooms.id, r.id));
          keysBackfilled += 1;
        }
        if (key && !roomByKey.has(key)) roomByKey.set(key, r.id);
      }

      // (b) Resolve each pending room value.
      const pending = await tx
        .select({ rawValue: unmappedSourceValues.rawValue })
        .from(unmappedSourceValues)
        .where(
          and(eq(unmappedSourceValues.kind, 'room'), eq(unmappedSourceValues.status, 'pending')),
        )
        .orderBy(unmappedSourceValues.rawValue);

      let roomsCreated = 0;
      let entriesRelinked = 0;
      let pendingResolved = 0;
      let unassignedBuildingId: string | null = null;

      for (const p of pending) {
        const key = roomDedupKey(p.rawValue);
        if (!key) continue; // pending values are non-blank, but guard the valve
        let roomId = roomByKey.get(key) ?? null;
        if (!roomId) {
          unassignedBuildingId ??= await ensureUnassignedBuilding(tx, this.tenantId);
          const ins = await tx
            .insert(rooms)
            .values({
              tenantId: this.tenantId,
              buildingId: unassignedBuildingId,
              name: roomDisplayName(p.rawValue),
              dedupKey: key,
            })
            .returning({ id: rooms.id });
          roomId = ins[0]?.id ?? null;
          if (!roomId) continue;
          roomByKey.set(key, roomId);
          roomsCreated += 1;
        }

        const blocked = await tx
          .select({
            id: timetableEntries.id,
            termId: timetableEntries.termId,
            sectionId: timetableEntries.sectionId,
            courseId: timetableEntries.courseId,
            teacherId: timetableEntries.teacherId,
            dayOfWeek: timetableEntries.dayOfWeek,
            startsAt: timetableEntries.startsAt,
            endsAt: timetableEntries.endsAt,
            kind: timetableEntries.kind,
          })
          .from(timetableEntries)
          .where(
            and(
              isNull(timetableEntries.validTo),
              isNull(timetableEntries.roomId),
              sql`lower(${timetableEntries.roomSource}) = ${p.rawValue.toLowerCase()}`,
            ),
          );
        for (const e of blocked) {
          const contentHash = computeContentHash({
            termId: e.termId,
            sectionId: e.sectionId,
            courseId: e.courseId,
            teacherId: e.teacherId,
            roomId,
            dayOfWeek: e.dayOfWeek,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            kind: e.kind,
          });
          await tx
            .update(timetableEntries)
            .set({ roomId, contentHash })
            .where(eq(timetableEntries.id, e.id));
          entriesRelinked += 1;
        }

        await tx
          .update(unmappedSourceValues)
          .set({ status: 'resolved', resolvedId: roomId, updatedAt: new Date() })
          .where(
            and(
              eq(unmappedSourceValues.kind, 'room'),
              eq(unmappedSourceValues.rawValue, p.rawValue),
            ),
          );
        pendingResolved += 1;
      }

      return { keysBackfilled, roomsCreated, entriesRelinked, pendingResolved };
    });
  }
}
