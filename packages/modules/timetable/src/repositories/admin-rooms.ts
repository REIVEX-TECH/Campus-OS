import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { TenantScopedRepository } from '@campusos/db';
import { buildings, rooms } from '@campusos/db/schema';
import { computeContentHash, roomDedupKey, roomDisplayName } from '../domain/index';
import { ensureUnassignedBuilding } from '../ingestion/ensure-building';
import { timetableEntries } from '../schema/entries';
import { unmappedSourceValues } from '../schema/ingestion';

export interface RoomListItem {
  id: string;
  name: string;
  buildingName: string;
  capacity: number | null;
  /** Current entries scheduled in this room. */
  entryCount: number;
}

export interface BackfillRoomsResult {
  /** Existing rooms that had `dedup_key` populated by this run. */
  keysBackfilled: number;
  /** Canonical rooms created from previously-pending room strings. */
  roomsCreated: number;
  /** TBA entries relinked to a room. */
  entriesRelinked: number;
  /** Duplicate TBA entries closed because a current entry already held the slot. */
  entriesClosed: number;
  /** Pending room values marked resolved. */
  pendingResolved: number;
  /** `dedup_key` values held by more than one live room (would block the unique index). */
  duplicateKeys: number;
}

/**
 * Tenant-scoped (RLS, via TenantScopedRepository -> withTenant) admin reads and
 * edits for rooms. Rooms are trusted crawl data that auto-create on ingest, so
 * this is read-mostly: list the rooms and rename a display label. Renaming never
 * touches `dedup_key`, so a re-crawl of the original source string still resolves
 * to the same room. `backfillRooms` is the one-shot rollout migration used by
 * scripts/backfill-rooms.ts.
 */
export class AdminRoomsRepository extends TenantScopedRepository {
  /** All live rooms with their building, capacity, and current class count. */
  listRooms(): Promise<RoomListItem[]> {
    return this.run(async (tx) => {
      const roomRows = await tx
        .select({
          id: rooms.id,
          name: rooms.name,
          capacity: rooms.capacity,
          buildingName: buildings.name,
        })
        .from(rooms)
        .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
        .where(isNull(rooms.deletedAt))
        .orderBy(rooms.name);

      const counts = await tx
        .select({ roomId: timetableEntries.roomId, n: sql<number>`count(*)::int` })
        .from(timetableEntries)
        .where(isNull(timetableEntries.validTo))
        .groupBy(timetableEntries.roomId);
      const byRoom = new Map<string, number>();
      for (const c of counts) if (c.roomId) byRoom.set(c.roomId, Number(c.n));

      return roomRows.map((r) => ({
        id: r.id,
        name: r.name,
        buildingName: r.buildingName,
        capacity: r.capacity,
        entryCount: byRoom.get(r.id) ?? 0,
      }));
    });
  }

  /**
   * Rename a room's DISPLAY name only. `dedup_key` is deliberately left unchanged
   * so a re-crawl of the original source string still resolves to this room (no
   * duplicate). Returns the updated `{ id, name }`, or null if the room does not
   * exist or the name is blank.
   */
  async renameRoom(roomId: string, name: string): Promise<{ id: string; name: string } | null> {
    const display = roomDisplayName(name);
    if (!display) return null;
    return this.run(async (tx) => {
      const updated = await tx
        .update(rooms)
        .set({ name: display, updatedAt: new Date() })
        .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
        .returning({ id: rooms.id, name: rooms.name });
      return updated[0] ?? null;
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
   * Idempotent. Also reports `duplicateKeys` so the caller can decide whether the
   * partial unique index on (tenant_id, dedup_key) can be created.
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
      let entriesClosed = 0;
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
          // Guard the partial unique index tt_entries_current_hash_uq: if another
          // CURRENT entry already carries this exact slot+room hash (e.g. the same
          // slot was crawled under two spellings, one of which had already matched
          // the room by its old case-insensitive name), relinking this one would
          // collide. It is a redundant duplicate of an already-correct current
          // row, so close it instead of relinking (what planTimetableDiff would
          // do on the next ingest). Otherwise relink in place.
          const clash = await tx
            .select({ id: timetableEntries.id })
            .from(timetableEntries)
            .where(
              and(
                isNull(timetableEntries.validTo),
                eq(timetableEntries.contentHash, contentHash),
                ne(timetableEntries.id, e.id),
              ),
            )
            .limit(1);
          if (clash[0]) {
            await tx
              .update(timetableEntries)
              .set({ validTo: new Date() })
              .where(eq(timetableEntries.id, e.id));
            entriesClosed += 1;
          } else {
            await tx
              .update(timetableEntries)
              .set({ roomId, contentHash })
              .where(eq(timetableEntries.id, e.id));
            entriesRelinked += 1;
          }
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

      // Live rooms whose dedup_key is shared with another live room. The partial
      // unique index cannot be created while any exist (they need a room merge).
      const dupRows = await tx
        .select({ key: rooms.dedupKey })
        .from(rooms)
        .where(and(isNull(rooms.deletedAt), sql`${rooms.dedupKey} is not null`))
        .groupBy(rooms.dedupKey)
        .having(sql`count(*) > 1`);

      return {
        keysBackfilled,
        roomsCreated,
        entriesRelinked,
        entriesClosed,
        pendingResolved,
        duplicateKeys: dupRows.length,
      };
    });
  }
}
