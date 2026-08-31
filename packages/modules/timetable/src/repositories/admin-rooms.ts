import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantScopedRepository, type TenantTransaction } from '@campusos/db';
import { buildings, campuses, rooms } from '@campusos/db/schema';
import { computeContentHash } from '../domain/index';
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
        const buildingId = await this.ensureBuilding(tx);
        const created = await tx
          .insert(rooms)
          .values({ tenantId: this.tenantId, buildingId, name })
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

  /** Return a building id, creating a default campus + building if none exists. */
  private async ensureBuilding(tx: TenantTransaction): Promise<string> {
    const existing = await tx.select({ id: buildings.id }).from(buildings).limit(1);
    if (existing[0]) return existing[0].id;
    const camp = await tx
      .insert(campuses)
      .values({ tenantId: this.tenantId, name: 'Main Campus' })
      .returning({ id: campuses.id });
    const campusId = camp[0]?.id;
    if (!campusId) throw new RoomResolveError('invalid_input', 'campus insert returned no row');
    const b = await tx
      .insert(buildings)
      .values({ tenantId: this.tenantId, campusId, name: 'Unassigned Building' })
      .returning({ id: buildings.id });
    const buildingId = b[0]?.id;
    if (!buildingId) throw new RoomResolveError('invalid_input', 'building insert returned no row');
    return buildingId;
  }
}
