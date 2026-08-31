import { createTimetableRepositories } from '@campusos/module-timetable/repositories';
import type { AdminRoomsRepository } from '@campusos/module-timetable/repositories';

// Tenant-scoped admin room repository for the resolved slug. Goes through the
// module repository (which sets the RLS tenant context), never the raw db client
// (banned by the import guard).
export function getAdminRooms(slug: string): AdminRoomsRepository {
  return createTimetableRepositories(slug).adminRooms;
}
