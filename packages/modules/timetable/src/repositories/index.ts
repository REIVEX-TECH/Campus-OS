import { TimetableRepository } from './timetable';

export { TimetableRepository, type ApplyDiffStats } from './timetable';

/** Construct the timetable repositories bound to a tenant. */
export function createTimetableRepositories(tenantId: string) {
  return {
    timetable: new TimetableRepository(tenantId),
  };
}

export type TimetableRepositories = ReturnType<typeof createTimetableRepositories>;
