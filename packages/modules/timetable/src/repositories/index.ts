import { AdminRoomsRepository } from './admin-rooms';
import { TimetableRepository } from './timetable';

export { TimetableRepository, type ApplyDiffStats } from './timetable';
export {
  AdminRoomsRepository,
  RoomResolveError,
  type BackfillRoomsResult,
  type PendingRoom,
  type RoomOption,
  type ResolveRoomInput,
  type ResolveRoomResult,
} from './admin-rooms';

/** Construct the timetable repositories bound to a tenant. */
export function createTimetableRepositories(tenantId: string) {
  return {
    timetable: new TimetableRepository(tenantId),
    adminRooms: new AdminRoomsRepository(tenantId),
  };
}

export type TimetableRepositories = ReturnType<typeof createTimetableRepositories>;
