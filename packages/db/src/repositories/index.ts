import { BuildingRepository } from './buildings';
import { CampusRepository } from './campuses';
import { RoomRepository } from './rooms';

export { CampusRepository } from './campuses';
export { BuildingRepository } from './buildings';
export { RoomRepository } from './rooms';
export { universitiesRepository } from './universities';
export { TenantScopedRepository } from './tenant-scoped';

/** Construct the tenant-bound repositories. Requires a tenant id (RLS context). */
export function createTenantRepositories(tenantId: string) {
  return {
    campuses: new CampusRepository(tenantId),
    buildings: new BuildingRepository(tenantId),
    rooms: new RoomRepository(tenantId),
  };
}

export type TenantRepositories = ReturnType<typeof createTenantRepositories>;
